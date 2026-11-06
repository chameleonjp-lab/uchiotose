import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3, Quaternion } from 'three';
import { getFlightAssist, autoFireTarget } from '../src/flight-assist';
import { FLIGHT_FOV, getFlightCameraPose } from '../src/flight-view';
import { clearFlightAssistance, createFlightTargetLock } from '../src/flight-target';

const numeric = true, callback = false;
const input = { turn: 0, climb: 0, fire: false, loop: false, viewAspect: 393 / 852 };
function player(): any { return {id:1, kind:'aircraft', team:'friendly', health:80, position:numeric?{x:0,y:300,z:0}:new Vector3(0,300,0),
  previous:new Vector3(0,300,0),quaternion:numeric?{x:0,y:0,z:0,w:1}:new Quaternion(), pitch:0,yaw:0,bank:0,speed:110,loopProgress:0,loopCooldown:0}; }
function target(p:any, id:number, x:number, y:number, depth:number, extra:any = {}): any {
  const position = new Vector3(), rotation = new Quaternion();
  if(numeric) { const c=getFlightCameraPose(p,'easy'); position.set(c.position.x,c.position.y,c.position.z);rotation.set(c.rotation.x,c.rotation.y,c.rotation.z,c.rotation.w); }
  else getFlightCameraPose(p,'easy',position,rotation);
  const tan=Math.tan(FLIGHT_FOV*Math.PI/360), point=new Vector3(x*depth*tan*input.viewAspect,y*depth*tan,-depth).applyQuaternion(rotation).add(position);
  return {id,kind:'aircraft',team:'enemy',health:80,hp:80,generation:1,identityGeneration:1,position:numeric?{x:point.x,y:point.y,z:point.z}:point,
    velocity:numeric?{x:0,y:0,z:0}:new Vector3(),quaternion:numeric?{x:0,y:0,z:0,w:1}:new Quaternion(),speed:0,aimHeight:0,...extra};
}
function assist(p:any, ts:any[], i:any=input, lock:any=createFlightTargetLock()) {
  return callback ? getFlightAssist(p,ts,i,'easy',undefined,lock) : getFlightAssist(p,ts,i,'easy',lock);
}
function fire(p:any,ts:any[],lock:any) { return callback ? autoFireTarget(p,ts,'easy',input.viewAspect,undefined,lock) : autoFireTarget(p,ts,'easy',input.viewAspect,lock); }
test('both modes ignore target positions while steering and keep response one',()=>{
 for(const mode of ['easy','normal'] as const)for(const ts of [[],[target(player(),2,.8,.55,500)],[target(player(),3,2,0,500)]]){
  const p=player(),lock=createFlightTargetLock(),i={...input,turn:.1,climb:-.02};
  assert.deepEqual(getFlightAssist(p,ts,i,mode,lock),{turn:.1,climb:-.02,responseMultiplier:1,hasVisibleTarget:false});assert.equal(lock.key,null);
 }
});
test('valid circle target wins deterministically over nearer off-circle targets',()=>{
 for(const reversed of [false,true]){const p=player(),a=target(p,2,0,0,950),b=target(p,3,.8,.55,400),ts=reversed?[b,a]:[a,b],lock=createFlightTargetLock();
  assert.equal(fire(p,ts,lock)?.id,2);a.hp=0;assert.equal(fire(p,ts,lock),null);assert.equal(lock.key,null);
 }
});
test('fire phase selects current valid target after movement and identity changes',()=>{
 const p=player(),lock=createFlightTargetLock(),a=target(p,2,0,0,950),b=target(p,3,.8,.55,400);
 assert.equal(fire(p,[a,b],lock)?.id,2);const selected=lock.key;
 a.position=target(p,2,.8,.55,950).position;b.position=target(p,3,0,0,400).position;
 assert.equal(fire(p,[a,b],lock)?.id,3);assert.notEqual(lock.key,selected);
 b.generation=2;b.identityGeneration=2;assert.equal(fire(p,[b],lock)?.id,3);
 b.hp=0;assert.equal(fire(p,[b],lock),null);
});
import { createSimulation, setSimulationPhase, releaseSimulationInput } from '../src/simulation';
test('pause and input-release reset assistance on the same aircraft without changing cruise speed',()=>{
 let state=createSimulation({missionId:'aim-reset',phase:'playing',mode:'easy'});state=releaseSimulationInput(state);
 const plane=state.world.aircraft[state.mission.controlledAircraftId!],speed=plane.controller.playerTargetSpeed;
 plane.controller.assistTurn=.25;plane.controller.assistClimb=.15;plane.controller.targetLock.key='old';
 state=setSimulationPhase(state,'paused');state=setSimulationPhase(state,'playing');state=releaseSimulationInput(state);
 const reset=state.world.aircraft[state.mission.controlledAircraftId!].controller;
 assert.equal(reset.targetLock.key,null);assert.equal(reset.assistTurn,0);assert.equal(reset.assistClimb,0);assert.equal(reset.playerTargetSpeed,speed);
 assert.equal(plane.controller.targetLock.key,'old','world clone must not mutate the prior snapshot');
});
