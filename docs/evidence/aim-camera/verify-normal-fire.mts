import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {Vector3,Quaternion} from 'three';
const repo='uchiotose',seed=20261011,neutral={turn:0,climb:0,fire:false,loop:false,steeringRevision:0,viewAspect:393/852};
import * as module from '../../../src/simulation.ts';
import * as view from '../../../src/flight-view.ts';
async function make(_repo:string,mode='normal'){let state=module.releaseSimulationInput(module.createSimulation({seed,missionId:'camera-audit',mode,phase:'playing'}));return{step(i:any){state=module.stepSimulation(state,i,mode)},player:()=>state.world.aircraft[state.mission.controlledAircraftId],shots:()=>state.metrics.aircraftShots};}
function snapshot(p:any){assert.ok(p,'a live controlled aircraft must exist');return {position:{x:p.position.x,y:p.position.y,z:p.position.z},rotation:{x:p.quaternion.x,y:p.quaternion.y,z:p.quaternion.z,w:p.quaternion.w},pitch:p.pitch,yaw:p.yaw,bank:p.bank,speed:p.speed};}
const camera=(p:any)=>view.getFlightCameraPose(p,'normal');
 const cases=[];
 for(const steer of [neutral,{...neutral,turn:.2,climb:.15},{...neutral,turn:-.6,climb:-.2}]){
  const noFire=await make(repo),fire=await make(repo);
  const before=snapshot(noFire.player());assert.deepEqual(before,snapshot(fire.player()));
  for(let tick=0;tick<12;tick++){
   noFire.step(steer);fire.step({...steer,fire:true});
   assert.deepEqual(snapshot(noFire.player()),snapshot(fire.player()),`${repo} fire changes flight at ${tick}`);
   assert.deepEqual(camera(noFire.player()),camera(fire.player()),`${repo} fire changes nominal chase camera at ${tick}`);
  }
  assert.ok(fire.shots()>0,`${repo}: fire must actually emit shots in this comparison`);assert.equal(noFire.shots(),0,`${repo}: no fire must not emit player shots`);
  cases.push({input:steer,ticks:12,before,after:snapshot(fire.player()),sameAttitudeAndPosition:true,sameNominalCamera:true,shotsWithFire:fire.shots(),shotsWithoutFire:noFire.shots()});
 }

writeFileSync(new URL('./normal-fire-result.json',import.meta.url),JSON.stringify({runtime:process.version,seed,repo,scope:'actual public simulation; 12 ticks x 3 commands; nominal camera only',comparedTicks:36,cases},null,2));
console.log(JSON.stringify({repo,comparedTicks:36,cases:cases.length,shots:cases.map(c=>[c.shotsWithoutFire,c.shotsWithFire])}));
