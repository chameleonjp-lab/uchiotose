import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { createSimulation, releaseSimulationInput, stepSimulation, setSimulationPhase } from '../src/simulation';
import { stepWorld, syncWorldState } from '../src/world';
import { completeMissionTick } from '../src/roster';
import { createFlightController, updatePlayerLoop, updateQuaternion } from '../src/flight';
import { getFlightCameraPose } from '../src/flight-view';
import { autoFireTarget } from '../src/flight-assist';
import { attitudeQuaternion, transformDirection, vec, distance } from '../src/world-math';
import { WorldRenderer } from '../src/world-renderer';
const neutral={turn:0,climb:0,fire:false,loop:false,viewAspect:402/874};
function encounter(mode:'easy'|'normal',x=0,depth=500){
 const s=releaseSimulationInput(createSimulation({missionId:'manual',seed:73,phase:'playing',mode}));
 const p=s.world.aircraft.A001;Object.assign(p,{position:vec(4000,1500,0),previousPosition:vec(4000,1500,0),yaw:0,pitch:0,bank:0,quaternion:attitudeQuaternion(0,0,0),previousQuaternion:attitudeQuaternion(0,0,0),forward:vec(0,0,-1)});
 for(const e of s.mission.enemies.filter(e=>e.status==='active')){const ep=s.world.enemies[e.id];ep.position=vec(-4000,2000,4000);ep.previousPosition={...ep.position};}
 const c=getFlightCameraPose(p,mode),t=s.world.enemies.E001;
 const offset=transformDirection(vec(x,0,-depth),c.rotation);t.position=vec(c.position.x+offset.x,c.position.y+offset.y,c.position.z+offset.z);t.previousPosition={...t.position};t.velocity=vec(16,0,0);
 return s;
}
for(const mode of ['easy','normal'] as const){
 test(`${mode}: enemy layout and loss cannot affect twelve authoritative flight ticks`,()=>{
  for(const command of [neutral,{...neutral,turn:.1,climb:.08},{...neutral,turn:-.3,steeringActive:true},{...neutral,turn:.2,climb:-.2,fire:true}]){
   let expected:unknown;
   for(const layout of ['none','front','circle-edge','screen-edge','behind','crossing']){
    const s=encounter(mode,layout==='circle-edge'?45:layout==='screen-edge'?105:0,layout==='behind'?-500:500);let w=s.world,m=s.mission;
    if(layout==='none')w.enemies.E001.position=vec(-4000,2500,4000);
    const trace=[];
    for(let tick=0;tick<12;tick++){
     if(layout==='crossing'){w.enemies.E001.position.x=tick<6?4105:3895;if(tick===9)m.enemies.find(e=>e.id==='E001')!.hp=0;}
     const next=stepWorld(w,m,command,mode);w=next.world;m=next.mission;const p=w.aircraft.A001;
     trace.push([p.position,p.quaternion,p.speed,getFlightCameraPose(p,mode),p.controller.responseMultiplier]);
    }
    expected??=trace;assert.deepEqual(trace,expected,layout);
   }
  }
 });
 test(`${mode}: centered held steering keeps pitch until release`,()=>{
  const p=encounter(mode).world.aircraft.A001;p.pitch=20*Math.PI/180;updateQuaternion(p);const c=createFlightController(p),held={...neutral,steeringActive:true};
  for(let i=0;i<12;i++)updatePlayerLoop(p,c,held,held,false,1/60,110,141,1,110,mode);
  assert.equal(p.pitch,20*Math.PI/180);updatePlayerLoop(p,c,neutral,neutral,false,1/60,110,141,1,110,mode);assert.ok(p.pitch<20*Math.PI/180&&p.pitch>19*Math.PI/180);
 });
 test(`${mode}: both player gun pairs launch straight and Normal release stops firing`,()=>{
  for(const fire of [true,false]){const s=stepSimulation(encounter(mode,15),{...neutral,fire},mode),p=s.world.aircraft.A001,shots=s.projectiles.filter(b=>b.ownerId==='A001');
   assert.equal(shots.length,mode==='easy'||fire?4:0);assert.deepEqual(shots.map(b=>b.kind),shots.length?['mg','mg','cannon','cannon']:[]);
   for(const shot of shots){const v=shot.velocity,n=Math.hypot(v.x,v.y,v.z);assert.ok(distance(vec(v.x/n,v.y/n,v.z/n),p.forward)<1e-12);}
  }
 });
}
test('Easy trigger chooses from live valid targets after movement without a steering selection',()=>{
 const p=encounter('easy').world.aircraft.A001,c=createFlightController(p),pose=getFlightCameraPose(p,'easy');
 const make=(x:number,d:number,hp=80)=>({id:'E001',hp,velocity:vec(),position:(()=>{const o=transformDirection(vec(x,0,-d),pose.rotation);return vec(pose.position.x+o.x,pose.position.y+o.y,pose.position.z+o.z);})()});
 for(const [x,d,aspect,want] of [[0,500,402/874,true],[55,500,402/874,false],[55,500,874/402,true],[0,1300,402/874,false],[500,500,402/874,false]] as const){const t=make(x,d);assert.equal(autoFireTarget(p,[t],'easy',aspect,c.targetLock)!==null,want);}
 assert.equal(autoFireTarget(p,[make(0,500,0)],'easy',402/874,c.targetLock),null);
});
function renderFixture(s:ReturnType<typeof encounter>){
 const view=Object.create(WorldRenderer.prototype) as any;
 const root={position:new Vector3(),quaternion:new Quaternion()};
 Object.assign(view,{disposed:false,queue:{poll:()=> 'ready',submit:()=>{}},missionId:s.mission.missionId,resetVersion:s.mission.controlResetVersion,viewRevision:0,
  planes:[{root,propeller:{rotation:{z:0}},ailerons:[{rotation:{x:0}},{rotation:{x:0}}],elevator:{rotation:{x:0}}}],enemies:[],fleet:Array.from({length:10},()=>({position:new Vector3(),quaternion:new Quaternion()})),previousBodies:new Map(),burstPool:[],
  updateWarriorBatches:()=>{},updateProjectiles:()=>{},updateEffects:()=>{},drawOverlay:(w:unknown)=>{view.overlayWorld=w;},camera:new PerspectiveCamera(64,1,.5,22000),sky:{position:new Vector3()},sea:{position:new Vector3()},seaMaterial:{uniforms:{uTime:{value:0}}},renderer:{render:()=>{},info:{render:{calls:1,triangles:1}}}});
 return {view,root};
}
test('render alpha zero uses the previous numeric attitude and bank',()=>{
 for(const mode of ['easy','normal'] as const){const s=encounter(mode),before=getFlightCameraPose(s.world.aircraft.A001,mode),{view,root}=renderFixture(s),input={...neutral,turn:1,steeringActive:true};
  const next=stepWorld(s.world,s.mission,input,mode);view.render(next.world,next.mission,[],mode,0);
  const q=new Quaternion(before.rotation.x,before.rotation.y,before.rotation.z,before.rotation.w);
  assert.ok(1-Math.abs(view.camera.quaternion.dot(q))<1e-12);assert.ok(1-Math.abs(root.quaternion.w)<1e-12);
  assert.deepEqual(view.overlayWorld.enemies.E001.position,next.world.enemies.E001.previousPosition);
 }
});
test('120Hz display interpolates every camera direction while fixed simulation stays unchanged',()=>{
 for(const mode of ['easy','normal'] as const){let s=encounter(mode),{view}=renderFixture(s);let previous:Vector3|undefined,repeats=0;
  for(let frame=1;frame<=52;frame++){if(frame%2===0){const next=stepWorld(s.world,s.mission,{...neutral,climb:.45,steeringActive:true},mode);s={...s,...next};}
   view.render(s.world,s.mission,[],mode,frame%2===0?0:.5);const forward=new Vector3(0,0,-1).applyQuaternion(view.camera.quaternion);
   if(frame>4&&previous&&forward.distanceTo(previous)<1e-12)repeats++;previous=forward;
  }
  assert.equal(repeats,0);
 }
});

test('pause and resume discard the old presentation interval before the next flight tick',()=>{
 let s=encounter('normal');s=stepSimulation(s,{...neutral,turn:1,steeringActive:true},'normal');
 const before=s.world.aircraft.A001;const paused=setSimulationPhase(s,'paused');const resumed=releaseSimulationInput(setSimulationPhase(paused,'playing'));
 const {view}=renderFixture(resumed);view.render(resumed.world,resumed.mission,[],'normal',0);
 const c=getFlightCameraPose(before,'normal');assert.ok(1-Math.abs(view.camera.quaternion.dot(new Quaternion(c.rotation.x,c.rotation.y,c.rotation.z,c.rotation.w)))<1e-12);
});

import { drawHUDOverlay } from '../src/hud-overlay';
test('reticle color follows displayed entry, exit and ID switch at alpha 0, half and 1',()=>{
 for(const mode of ['easy','normal'] as const)for(const transition of ['entry','exit','id-switch']){
  const s=encounter(mode),p=s.world.aircraft.A001,{view}=renderFixture(s),camera=getFlightCameraPose(p,mode);
  s.mission.aircraft=s.mission.aircraft.filter(a=>a.id==='A001');s.mission.ships=[];s.mission.enemies=s.mission.enemies.filter(e=>e.id==='E001'||(transition==='id-switch'&&e.id==='E002'));
  const base=mode==='easy'?vec(camera.position.x+transformDirection(vec(0,0,-500),camera.rotation).x,camera.position.y+transformDirection(vec(0,0,-500),camera.rotation).y,camera.position.z+transformDirection(vec(0,0,-500),camera.rotation).z):vec(p.position.x+p.forward.x*500,p.position.y+p.forward.y*500,p.position.z+p.forward.z*500);
  const right=transformDirection(vec(1,0,0),camera.rotation),at=(x:number)=>vec(base.x+right.x*x,base.y+right.y*x,base.z+right.z*x);
  for(const e of s.mission.enemies){const pose=s.world.enemies[e.id],switchSecond=e.id==='E002';const outside=transition==='id-switch'?300:mode==='normal'?100:150;const entering=transition==='entry'||switchSecond;
   pose.previousPosition=at(entering?outside:0);pose.position=at(entering?0:outside);}
  // A live trigger selection cannot override a target still visibly inside the sampled circle.
  p.controller.targetLock.key='enemy:E002';
  const actual=[];
  for(const alpha of [0,.5,1]){view.render(s.world,s.mission,[],mode,alpha);view.camera.aspect=874/402;view.camera.updateProjectionMatrix();view.camera.updateMatrixWorld();let color='';
   const ctx=new Proxy({fillStyle:'',fillRect(_x:number,_y:number,w:number,h:number){if(w===2&&h===2)color=this.fillStyle;}},{get:(o:any,k)=>k in o?o[k]:()=>{}}) as unknown as CanvasRenderingContext2D;
   drawHUDOverlay(ctx,874,402,view.overlayWorld,s.mission,mode,view.lastPlayer,view.camera);actual.push(color);
  }
  const expected=transition==='entry'?['#ffffff','#ff645b','#ff645b']:transition==='exit'?['#ff645b','#ff645b','#ffffff']:['#ff645b','#ffffff','#ff645b'];
  assert.deepEqual(actual,expected,`${mode}/${transition}`);
 }
});

test('30, 60 and 120Hz displays leave identical flight, bullets, clock and outcomes',()=>{
 for(const mode of ['easy','normal'] as const){let expected:unknown;
  for(const hz of [30,60,120]){let s=encounter(mode,15),tick=0;const {view}=renderFixture(s);
   for(let frame=1;frame<=hz*.4;frame++){const time=frame*60/hz;while(tick<Math.floor(time)){s=stepSimulation(s,{...neutral,turn:.2,climb:.45,fire:true,steeringActive:true},mode);tick++;}view.render(s.world,s.mission,s.projectiles,mode,time-Math.floor(time));}
   const result={world:s.world,mission:s.mission,projectiles:s.projectiles};expected??=result;assert.deepEqual(result,expected,`${mode}/${hz}`);
  }
 }
});
test('loop cancellation keeps old and current camera phases aligned with numeric posture',()=>{
 for(const mode of ['easy','normal'] as const){const s=encounter(mode),p=s.world.aircraft.A001;p.loopProgress=.05;p.controller.playerLoopActive=true;p.controller.loopStartSteeringRevision=1;
  const before=getFlightCameraPose(p,mode),next=stepWorld(s.world,s.mission,{...neutral,turn:.4,steeringActive:true,steeringRevision:2},mode),{view}=renderFixture(s);assert.equal(next.world.aircraft.A001.loopProgress,0);
  for(const alpha of[0,1]){view.render(next.world,next.mission,[],mode,alpha);const pose=alpha?getFlightCameraPose(next.world.aircraft.A001,mode):before;assert.ok(1-Math.abs(view.camera.quaternion.dot(new Quaternion(pose.rotation.x,pose.rotation.y,pose.rotation.z,pose.rotation.w)))<1e-12);}
 }
});

test('zero-tick resume holds all aircraft, enemies, ships, projectiles and reticle at the current endpoint',()=>{
 for(const mode of ['easy','normal'] as const){let s=stepSimulation(encounter(mode),{...neutral,turn:.2,fire:true,steeringActive:true},mode);
  // Current endpoint is outside; the old interval placed this target inside.
  const p=s.world.aircraft.A001,pose=getFlightCameraPose(p,mode),base=mode==='easy'?vec(pose.position.x+transformDirection(vec(0,0,-500),pose.rotation).x,pose.position.y+transformDirection(vec(0,0,-500),pose.rotation).y,pose.position.z+transformDirection(vec(0,0,-500),pose.rotation).z):vec(p.position.x+p.forward.x*500,p.position.y+p.forward.y*500,p.position.z+p.forward.z*500),right=transformDirection(vec(1,0,0),pose.rotation);
  s.world.enemies.E001.previousPosition=base;s.world.enemies.E001.position=vec(base.x+right.x*300,base.y+right.y*300,base.z+right.z*300);
  const authoritative=JSON.stringify({world:s.world,projectiles:s.projectiles}),{view}=renderFixture(s);view.render(s.world,s.mission,s.projectiles,mode,1);
  const resumed=releaseSimulationInput(setSimulationPhase(setSimulationPhase(s,'paused'),'playing'));view.updateProjectiles=(_rounds:unknown,alpha:number)=>{view.projectileAlpha=alpha;};view.render(resumed.world,resumed.mission,resumed.projectiles,mode,0);
  for(const kind of ['aircraft','enemies','ships'] as const)for(const [id,body]of Object.entries(s.world[kind]))assert.deepEqual(view.overlayWorld[kind][id].position,body.position,`${mode}/${kind}/${id}`);
  assert.ok(resumed.projectiles.length>0);assert.equal(view.projectileAlpha,1,'interpolated projectile renderer also uses the current endpoint');
  assert.equal(JSON.stringify({world:s.world,projectiles:s.projectiles}),authoritative,'phase reset must not mutate the source snapshot');
  const actual=[];for(const alpha of[0,.5,1]){view.render(resumed.world,resumed.mission,resumed.projectiles,mode,alpha);view.camera.aspect=874/402;view.camera.updateProjectionMatrix();view.camera.updateMatrixWorld();let color='';
   const ctx=new Proxy({fillStyle:'',fillRect(_x:number,_y:number,w:number,h:number){if(w===2&&h===2)color=this.fillStyle;}},{get:(o:any,k)=>k in o?o[k]:()=>{}}) as unknown as CanvasRenderingContext2D;
   drawHUDOverlay(ctx,874,402,view.overlayWorld,resumed.mission,mode,view.lastPlayer,view.camera);actual.push(color);}
  assert.deepEqual(actual,[actual[2],actual[2],actual[2]],`${mode}/reticle must not replay the old target interval`);
 }
});

test('pilot handoff holds all actors at the endpoint, then the next tick starts a fresh interval',()=>{
 for(const mode of ['easy','normal'] as const){const s=stepSimulation(encounter(mode),{...neutral,turn:.2,steeringActive:true},mode),{view}=renderFixture(s);view.render(s.world,s.mission,[],mode,1);
  const mission=completeMissionTick(s.mission,{missionId:s.mission.missionId,aircraftIds:['A001']}),world=syncWorldState(s.world,mission);assert.notEqual(mission.controlledAircraftId,'A001');view.render(world,mission,[],mode,0);
  for(const kind of ['aircraft','enemies','ships'] as const)for(const[id,body]of Object.entries(world[kind]))assert.deepEqual(view.overlayWorld[kind][id].position,body.position);
  const next=stepSimulation({...s,world,mission},neutral,mode);view.render(next.world,next.mission,[],mode,0);
  assert.deepEqual(view.overlayWorld.enemies.E001.position,next.world.enemies.E001.previousPosition);assert.notDeepEqual(view.overlayWorld.enemies.E001.position,next.world.enemies.E001.position);
 }
});
