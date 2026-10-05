import {chromium,expect as baseExpect} from '@playwright/test';
import fs from 'node:fs/promises';
const expect=baseExpect.configure({timeout:5000});
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const outputFile=new URL('./world-runtime-diagnosis.json',import.meta.url);
const output={started:new Date().toISOString(),trace:false,actionTimeoutMs:5000,viewport:{width:393,height:648},rounds:[]};
try {
 for(let round=0;round<3;round++){
  const context=await browser.newContext({viewport:output.viewport,isMobile:true,hasTouch:true,deviceScaleFactor:1});
  const page=await context.newPage();page.setDefaultTimeout(5000);const errors=[],checkpoints=[];let action='goto';
  page.on('console',message=>{if(message.type()==='error')errors.push({time:Date.now(),action,text:message.text()});});
  page.on('pageerror',error=>errors.push({time:Date.now(),action,text:error.message}));
  const record=async(tag)=>{const value=await page.evaluate(()=>{const api=window.__uchiotose,m=api?.snapshot().mission;return {time:performance.now(),missionId:m?.missionId,phase:m?.phase,tick:m?.tick,screen:document.querySelector('#app')?.dataset.screen,reason:document.querySelector('#pause-reason')?.textContent,resumeDisabled:document.querySelector('#resume')?.disabled,retryDisabled:document.querySelector('#pause-restart')?.disabled,diagnostics:api?.diagnostics()};});checkpoints.push({tag,...value});return value;};
  const waitPausedFrame=async(tag,id)=>{await expect.poll(async()=>await page.evaluate(()=>{const f=window.__uchiotose.diagnostics().renderer.lastSubmittedFrame;return f?{id:f.missionId,phase:f.phase}:null;})).toEqual({id,phase:'paused'});await expect.poll(async()=>await page.evaluate(()=>window.__uchiotose.diagnostics().renderer.queue.status)).toBe('ready');await record(`${tag}-frame-ready`);};
  let passed=false,failure=null;
  try{
   await page.goto('http://127.0.0.1:4176');await expect(page.locator('#start')).toBeEnabled({timeout:30000});await record('home-ready');
   action='select-Normal';await page.getByLabel('ノーマル',{exact:true}).check();
   action='start';await page.locator('#start').click();await expect(page.locator('#app')).toHaveAttribute('data-screen','playing');
   await expect.poll(async()=>await page.evaluate(()=>window.__uchiotose.snapshot().mission.tick)).toBeGreaterThan(2);await record('initial-playing');
   action='fire';await page.keyboard.down('Space');await expect.poll(async()=>await page.evaluate(()=>window.__uchiotose.snapshot().mission.aircraft[0].machineGunAmmo)).toBeLessThan(288);await page.keyboard.up('Space');
   action='pause-Escape';await page.keyboard.press('Escape');await expect(page.locator('#app')).toHaveAttribute('data-screen','paused');const paused=await record('paused');action='wait-initial-paused-frame';await waitPausedFrame('initial-paused',paused.missionId);await page.waitForTimeout(300);expect((await record('paused-300ms')).tick).toBe(paused.tick);
   action='rules';await page.locator('#pause-rules').click();await expect(page.locator('#rules-guide')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#app')).toHaveAttribute('data-screen','paused');
   action='settings';await page.locator('#pause-settings').click();await expect(page.locator('#control-settings')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#app')).toHaveAttribute('data-screen','paused');await record('after-modals');
   action='resume';await page.locator('#resume').click();await expect.poll(async()=>await page.evaluate(()=>window.__uchiotose.snapshot().mission.tick)).toBeGreaterThan(paused.tick);await expect(page.locator('#app')).toHaveAttribute('data-screen','playing');await record('resumed');
   action='pause-button';await page.locator('#pause-button').click();const initial=await record('pause-before-retries');await waitPausedFrame('before-retries',initial.missionId);let id=initial.missionId;
   for(let retry=0;retry<5;retry++){
    action=`retry-${retry}`;await page.locator('#pause-restart').click();await expect(page.locator('#app')).toHaveAttribute('data-screen','playing');await expect.poll(async()=>await page.evaluate(()=>window.__uchiotose.snapshot().mission.tick)).toBeGreaterThan(2);const current=await record(`retry-${retry}-playing`);expect(current.missionId).not.toBe(id);id=current.missionId;action=`wait-retry-${retry}-actual-frame`;await expect.poll(async()=>await page.evaluate(()=>window.__uchiotose.diagnostics().renderer.lastSubmittedFrame?.missionId)).toBe(id);
    action=`pause-after-retry-${retry}`;await expect(page.locator('#app')).toHaveAttribute('data-screen','playing');await page.locator('#pause-button').click();const pausedState=await record(`retry-${retry}-paused`);action=`wait-retry-${retry}-paused-frame`;await waitPausedFrame(`retry-${retry}-paused`,id);for(const key of ['geometries','textures','planes','warriors','ships'])expect(pausedState.diagnostics.renderer[key]).toBe(initial.diagnostics.renderer[key]);
   }
   action='home';await page.locator('#home-return').click();await expect(page.locator('#app')).toHaveAttribute('data-screen','home');const home=await record('home-return');action='wait-home-frame';await expect.poll(async()=>await page.evaluate(()=>window.__uchiotose.diagnostics().renderer.lastSubmittedFrame?.missionId)).toBe(home.missionId);await expect.poll(async()=>await page.evaluate(()=>window.__uchiotose.diagnostics().renderer.queue.status)).toBe('ready');await record('home-frame-ready');expect(errors).toEqual([]);passed=true;
  }catch(error){failure={action,text:error.message};await record('failure').catch(()=>{});}
  const data={round,passed,failure,errors,checkpoints};output.rounds.push(data);await fs.writeFile(outputFile,JSON.stringify(output,null,2));
  const last=checkpoints.at(-1);console.log(JSON.stringify({round,passed,failure,errors,last}));await context.close();
 }
}finally{await browser.close();}
