import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlSettings, CONTROL_NAMES, DEFAULT_LAYOUT, MODE_CONTROLS, decodeControlLayout, loadLayout, controlDimensions, rectangularBounds, safeThrottlePlacement, previewDimensions } from '../src/control-settings';
import { DEFAULT_KEY_BINDINGS, KEYBOARD_STORAGE_KEY, KEY_ACTIONS, KeyboardSettings } from '../src/keyboard-settings';
import { SETTINGS_RECOVERY_KEY, persistSettingsBatch, readSettingsValue, hasSettingsRecovery } from '../src/settings-storage';
import { controlLayoutSize, settingsViewportSize } from '../src/control-obstacles';
function storage() {
  const map = new Map<string, string>(), reads: string[] = [], writes: string[] = [];
  return { map, reads, writes, getItem(key: string) { reads.push(key); return map.get(key) ?? null; }, setItem(key: string, value: string) { writes.push(key); map.set(key, value); }, removeItem(key: string) { writes.push(key); map.delete(key); } };
}
const normal = 'uchiotose-controls-v2', easy = 'uchiotose-controls-easy-v2', legacy = 'uchiotose-controls-v1';
const value = (x = .3) => JSON.stringify({version: 2, controls: {...DEFAULT_LAYOUT, throttle: {...DEFAULT_LAYOUT.throttle, x}}});
const entry = (key = normal, next = value()) => ({key, value: next, maxVersion: key === KEYBOARD_STORAGE_KEY ? 1 : 2, ...(key === normal ? {legacyKey: legacy} : key === easy ? {legacyKey: 'uchiotose-controls-easy-v1'} : {})});
function withStorage<T>(data: ReturnType<typeof storage>, action: () => T): T {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'); Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: data});
  try { return action(); } finally { if (before) Object.defineProperty(globalThis, 'localStorage', before); else Reflect.deleteProperty(globalThis, 'localStorage'); }
}
test('U exposes three Normal controls, one Easy control and the existing nine keyboard actions only', () => {
  assert.deepEqual(CONTROL_NAMES, ['fire', 'loop', 'throttle']); assert.deepEqual(MODE_CONTROLS.normal, CONTROL_NAMES); assert.deepEqual(MODE_CONTROLS.easy, ['loop']);
  assert.equal(KEY_ACTIONS.length, 9); assert.equal(KEYBOARD_STORAGE_KEY, 'uchiotose-keyboard-v1'); assert.equal(Object.keys(DEFAULT_LAYOUT).length, 3);
});
test('v1 read migration preserves peer placements and old bytes, joins valid throttle placements', () => {
  for (const mirrored of [false, true]) {
    const old = {version: 1, controls: {fire: {x: .8, y: .82, size: 98, opacity: .7}, loop: DEFAULT_LAYOUT.loop,
      accelerate: {x: mirrored ? .83 : .17, y: .84, size: 76, opacity: .8}, brake: {x: mirrored ? .83 : .17, y: .66, size: 80, opacity: .9}}};
    const raw = JSON.stringify(old), layout = decodeControlLayout(raw, true);
    assert.deepEqual(layout.fire, old.controls.fire); assert.deepEqual(layout.loop, old.controls.loop);
    assert.equal(layout.throttle.x, old.controls.accelerate.x); assert.equal(layout.throttle.y, .75); assert.equal(layout.throttle.size, 78); assert.equal(layout.throttle.opacity, .8500000000000001); assert.equal(JSON.stringify(old), raw);
  }
  const malformed = JSON.stringify({version: 1, controls: {accelerate: {x: .8, y: .8, size: 80, opacity: .8}, brake: {x: 'bad'}}});
  assert.deepEqual(decodeControlLayout(malformed, true).throttle, {x:.8, y:.8, size:80, opacity:.8});
  for (const raw of ['{bad', '{"version":999}', 'null', '{"version":2,"controls":null}']) assert.deepEqual(decodeControlLayout(raw), DEFAULT_LAYOUT);
  const clamped = decodeControlLayout('{"version":2,"controls":{"throttle":{"x":-3,"y":8,"size":10000,"opacity":null}}}');
  assert.deepEqual(clamped.throttle, {x:0,y:1,size:140,opacity:.82});
});
test('load is read-only, v2 does not fall back to v1 and foreign games are not read', () => {
  const data = storage(); data.map.set(legacy, JSON.stringify({version:1,controls:{fire:{x:.2,y:.8,size:88,opacity:.8}}})); data.map.set('kaisen-controls-v1','foreign');
  withStorage(data, () => { assert.equal(loadLayout('normal').fire.x, .2); data.map.set(normal, '{"version":99}'); assert.deepEqual(loadLayout('normal'), DEFAULT_LAYOUT); data.map.set(normal, value(.7)); assert.equal(loadLayout('normal').throttle.x, .7); });
  assert.deepEqual(data.writes, []); assert.ok(data.reads.every(key=>key.startsWith('uchiotose-')));
});
test('both safe-area orientations place a rectangular lever without moving existing peers or changing saved data', () => {
  for (const [width,height] of [[320,568],[393,852],[568,320],[852,393]]) for (const mirrored of [false,true]) {
    const layout = structuredClone(DEFAULT_LAYOUT); layout.throttle.x = mirrored ? .83 : .17;
    const saved = JSON.stringify(layout), insets = {top:20,bottom:21,left:width>height?44:0,right:width>height?44:0};
    const placement = safeThrottlePlacement(layout,width,height,insets), size = controlDimensions('throttle',placement.size,width,height,insets), bounds=rectangularBounds(size,width,height,insets);
    assert.equal(placement.blocked,false); assert.ok(size.width>=44 && size.height>44); assert.ok(placement.x>=bounds.minX && placement.x<=bounds.maxX && placement.y>=bounds.minY && placement.y<=bounds.maxY);
    for (const name of ['fire','loop'] as const) { const peer=layout[name], d=controlDimensions(name,peer.size,width,height,insets), b=rectangularBounds(d,width,height,insets), x=Math.max(b.minX,Math.min(b.maxX,peer.x)),y=Math.max(b.minY,Math.min(b.maxY,peer.y)); assert.ok(Math.abs(placement.x-x)*width>=(size.width+d.width)/2+2-1e-9 || Math.abs(placement.y-y)*height>=(size.height+d.height)/2+2-1e-9); }
    assert.equal(JSON.stringify(layout),saved);
  }
});
test('HUD obstacles and a zero-length 44px rail block only the lever without mutating peers', () => {
  const layout=structuredClone(DEFAULT_LAYOUT), saved=JSON.stringify(layout), insets={top:0,bottom:0,left:0,right:0};
  assert.equal(safeThrottlePlacement(layout,320,568,insets,[{x:160,y:284,width:320,height:568}]).blocked,true);
  assert.equal(controlDimensions('throttle',44,100,44,insets).height,44); assert.equal(safeThrottlePlacement(layout,100,44,insets).blocked,true);
  assert.equal(JSON.stringify(layout),saved);
});
test('layout units and preview use the same unscaled coordinates at 200% zoom', () => {
  const element={offsetWidth:393,offsetHeight:852,getBoundingClientRect:()=>({width:786,height:1704})} as HTMLElement;
  assert.deepEqual(controlLayoutSize(element),{width:393,height:852}); assert.deepEqual(settingsViewportSize(element,786,1704),{width:393,height:852});
  const dimensions=previewDimensions(393,852,329,390); assert.ok(dimensions.width<=329 && dimensions.height<=390); assert.ok(Math.abs(dimensions.width/dimensions.height-393/852)<1e-10);
});
test('all entries preflight versions before writes; legacy and keyboard formats remain protected', () => {
  for (const futureKey of [normal,easy,KEYBOARD_STORAGE_KEY,legacy]) {
    const data=storage(); data.map.set(futureKey,'{"version":99}'); const before=[...data.map];
    assert.equal(persistSettingsBatch([entry(),entry(easy),entry(KEYBOARD_STORAGE_KEY,JSON.stringify({version:1,bindings:DEFAULT_KEY_BINDINGS}))],data),false);
    assert.deepEqual([...data.map],before); assert.deepEqual(data.writes,[]);
  }
});
test('v2 saves leave both old v1 raw keys and all foreign keys byte-identical', () => {
  const data=storage(); const protectedValues=[[legacy,' {"version":1,"controls":{}} '],['uchiotose-controls-easy-v1','{"version":1}'],['kaisen-controls-v2','foreign K'],['fantasia-controls-v2','foreign F'],['machimamore-controls-v2','foreign M']];
  for(const [key,raw]of protectedValues)data.map.set(key,raw);
  assert.equal(persistSettingsBatch([entry(),entry(easy)],data),true);
  for(const [key,raw]of protectedValues)assert.equal(data.getItem(key),raw);
  assert.equal(data.getItem(SETTINGS_RECOVERY_KEY),null); assert.ok(data.writes.every(key=>[normal,easy,SETTINGS_RECOVERY_KEY].includes(key)));
});
test('foreign/duplicate/oversized entries and spoofed legacy keys are rejected without writes', () => {
  for(const entries of [[entry('kaisen-controls-v2')],[entry(),entry()],[{...entry(),legacyKey:'kaisen-controls-v1'}],[{...entry(),maxVersion:999}],[entry(normal,'x'.repeat(65536))]]) {
    const data=storage(); assert.equal(persistSettingsBatch(entries,data),false); assert.deepEqual(data.writes,[]); assert.ok(data.reads.every(key=>key.startsWith('uchiotose-')));
  }
});
test('read or backup failure never writes product keys', () => {
  for(const blocked of ['read','backup']) { const data=storage(); if(blocked==='read')data.getItem=()=>{throw Error('denied');}; else data.setItem=()=>{throw Error('quota');}; assert.equal(persistSettingsBatch([entry()],data),false); assert.equal(data.map.size,0); }
});
test('partial write failure restores exact raw bytes and leaves the active settings unchanged', () => {
  const data=storage(); data.map.set(normal,'old normal'); data.map.set(KEYBOARD_STORAGE_KEY,'old keys');
  const write=data.setItem; data.setItem=(key,next)=>{if(key===KEYBOARD_STORAGE_KEY&&next==='new keys')throw Error('quota');write(key,next);};
  assert.equal(persistSettingsBatch([entry(),entry(easy),entry(KEYBOARD_STORAGE_KEY,'new keys')],data),false);
  assert.equal(data.getItem(normal),'old normal'); assert.equal(data.getItem(KEYBOARD_STORAGE_KEY),'old keys'); assert.equal(data.getItem(easy),null); assert.equal(data.getItem(SETTINGS_RECOVERY_KEY),null);
});
test('failed rollback retains a recoverable journal and safe reload; future/foreign concurrent changes refuse restoration', () => {
  const data=storage(); data.map.set(normal,'old normal'); data.map.set(KEYBOARD_STORAGE_KEY,'old keys'); let failRollback=true;
  const write=data.setItem;data.setItem=(key,next)=>{if(key===KEYBOARD_STORAGE_KEY&&next==='new keys'||failRollback&&key===normal&&next==='old normal')throw Error('quota');write(key,next);};
  assert.equal(persistSettingsBatch([entry(),entry(KEYBOARD_STORAGE_KEY,'new keys')],data),false);
  assert.equal(data.getItem(normal),value()); assert.ok(hasSettingsRecovery(data)); assert.equal(readSettingsValue(normal,data),'old normal'); assert.equal(readSettingsValue(KEYBOARD_STORAGE_KEY,data),'old keys');
  const journal=data.getItem(SETTINGS_RECOVERY_KEY); failRollback=false;
  for(const other of ['{"version":99}','external same-version write']) {data.map.set(normal,other);assert.equal(persistSettingsBatch([],data),false);assert.equal(data.getItem(normal),other);assert.equal(data.getItem(SETTINGS_RECOVERY_KEY),journal);}
  data.map.set(normal,value());assert.equal(persistSettingsBatch([],data),true);assert.equal(data.getItem(normal),'old normal');assert.equal(data.getItem(SETTINGS_RECOVERY_KEY),null);
});
test('invalid recovery journal does not mutate or read outside the allowlist', () => {
  for(const previous of [[{key:'kaisen-controls-v1',value:'old',next:'new'}],[{key:normal,value:'old',next:'new'},{key:normal,value:'old',next:'new'}]]) {
    const data=storage();data.map.set(SETTINGS_RECOVERY_KEY,JSON.stringify({version:1,previous}));assert.equal(persistSettingsBatch([entry()],data),false);assert.deepEqual(data.writes,[]);assert.deepEqual(data.reads,[SETTINGS_RECOVERY_KEY]);
  }
});
function dialogFixture() {
  const keyboard=new KeyboardSettings(), nodes=new Map<string,any>();
  const dialog={open:false,returnValue:'',close(value:string){this.returnValue=value;this.open=false;},showModal(){this.open=true;},style:{setProperty(){}},querySelector(selector:string){if(!nodes.has(selector))nodes.set(selector,{textContent:'',hidden:true,scrollTop:0,scrollIntoView(){},focus(){}});return nodes.get(selector);}};
  const saved={normal:structuredClone(DEFAULT_LAYOUT),easy:structuredClone(DEFAULT_LAYOUT)};
  const editor:any=Object.assign(Object.create(ControlSettings.prototype),{keyboard,dialog,saved,draft:structuredClone(saved),keyDraft:keyboard.bindings,allowedModes:['normal','easy'],activeMode:'normal',layoutMode:'normal',capturing:null,editor:'keyboard',dragPointer:null,dragControl:null,returnFocus:null,saveFailedAwaitingUse:false,storageUnavailable:false,recoveryPending:false,
    select:{value:''},modeSelect:{value:'normal',disabled:false,options:[]},inputPresentation:{value:'keyboard'},clearInput(){},apply(){},updateEditor(){},renderKeys(){},setEditor(){},refreshLayout(){}});
  return {keyboard,dialog,editor,nodes};
}
test('dialog saves together, Cancel discards drafts, and session-only does not persist or survive reload', () => {
  const data=storage();withStorage(data,()=>{
    const f=dialogFixture();f.editor.draft.normal.throttle.x=.3;f.editor.draft.easy.loop.x=.2;f.editor.keyDraft.fire='KeyQ';f.editor.save();
    assert.equal(f.dialog.returnValue,'save');assert.equal(f.keyboard.code('fire'),'KeyQ');assert.equal(JSON.parse(data.getItem(normal)!).controls.throttle.x,.3);
    f.editor.draft.normal.throttle.x=.8;f.editor.keyDraft.fire='KeyB';f.editor.onClosed();assert.equal(f.editor.draft.normal.throttle.x,.3);assert.equal(f.editor.keyDraft.fire,'KeyQ');
    const write=data.setItem;data.setItem=()=>{throw Error('blocked');};f.editor.draft.normal.throttle.x=.4;f.editor.keyDraft.fire='KeyB';f.dialog.returnValue='';f.editor.save();
    assert.equal(f.dialog.returnValue,'');assert.equal(f.keyboard.code('fire'),'KeyQ');assert.equal(f.editor.saved.normal.throttle.x,.3);assert.equal(f.editor.saveFailedAwaitingUse,true);
    f.editor.save();assert.equal(f.dialog.returnValue,'session-only');assert.equal(f.keyboard.code('fire'),'KeyB');assert.equal(f.editor.saved.normal.throttle.x,.4);
    data.setItem=write;assert.equal(new KeyboardSettings().code('fire'),'KeyQ');assert.equal(loadLayout('normal').throttle.x,.3);
  });
});
test('failed rollback then Cancel, real open, unchanged Save re-reads and retries recovery', () => {
  const data=storage();data.map.set(normal,value(.17));const initialKeyboard=JSON.stringify({version:1,bindings:DEFAULT_KEY_BINDINGS});data.map.set(KEYBOARD_STORAGE_KEY,initialKeyboard);
  withStorage(data,()=>{
    const f=dialogFixture();let fail=true;const write=data.setItem;data.setItem=(key,next)=>{if(fail&&(key===KEYBOARD_STORAGE_KEY&&next!==initialKeyboard||key===normal&&next===value(.17)))throw Error('quota');write(key,next);};
    f.editor.draft.normal.throttle.x=.3;f.editor.keyDraft.fire='KeyQ';f.editor.save();assert.ok(hasSettingsRecovery(data));assert.equal(f.keyboard.code('fire'),'Space');
    f.editor.onClosed();assert.equal(f.editor.saveFailedAwaitingUse,false);f.editor.recoveryPending=false;
    f.editor.open({focus(){}} as any,'normal',true);assert.equal(f.editor.recoveryPending,true);assert.equal(f.dialog.open,true);
    assert.equal(new KeyboardSettings().code('fire'),'Space');assert.equal(loadLayout('normal').throttle.x,.17);
    fail=false;f.editor.save();assert.equal(f.dialog.returnValue,'save');assert.equal(data.getItem(normal),value(.17));assert.equal(data.getItem(KEYBOARD_STORAGE_KEY),initialKeyboard);assert.equal(data.getItem(SETTINGS_RECOVERY_KEY),null);
  });
});
