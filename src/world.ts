/** P2: authoritative, serializable 60 Hz movement; presentation never enters this state. */
import { TICKS_PER_SECOND } from './roster';
import type { MissionState, DeathBatch, IceState, SpawnGuard } from './roster';
import { createFlightController, forwardOf, updateQuaternion, desiredFlightInput, updateAircraftMotion, updatePlayerLoop,
  advanceThrottle, MAX_SPEED, CRUISE_SPEED } from './flight';
import type { FlightController } from './flight';
import { getFlightAssist } from './flight-assist';
import type { FlightAircraft, FlightInput, GameMode, FlightTarget } from './flight-types';
import { sweepIsland, sweepSea, lineOfSight } from './island';
import { CAPITAL_SHIP } from './fleet-geometry';
import { sweptShipHit } from './world-collision';
import { vec, add, sub, scale, length, distance, dot, normalize, clamp, angle, attitudeQuaternion, lerp } from './world-math';
import type { Vec3, Quat } from './world-math';
export type { Vec3, Quat } from './world-math';
export type { FlightInput, GameMode } from './flight-types';
export { transformDirection } from './world-math';
export { sweepIsland, sweepSea, lineOfSight } from './island';
export { segmentSphereHit, segmentBoxHit, sweptShipHit, interceptDirection } from './world-collision';
export const WORLD_RADIUS = 6000, WORLD_CEILING = 2500;
export const WORLD_WARNING_RADIUS = 5500, WORLD_WARNING_CEILING = 2300;
export const ENEMY_MIN_SPEED = 10 / 3.6, ENEMY_MAX_SPEED = 60 / 3.6;
export const ENEMY_MAX_ACCELERATION = 8, ENEMY_MAX_TURN_RATE = 120 * Math.PI / 180;
export const AIRCRAFT_RADIUS = 6, ENEMY_RADIUS = 2.5;
export const FIXED_WORLD_DT = 1 / TICKS_PER_SECOND;
const ICE_REDUCTION = 50 / 3.6;
const byId=<T extends {id:string}>(items:readonly T[]):T[]=>[...items].sort((a,b)=>a.id.localeCompare(b.id));
const entriesById=<T>(items:Record<string,T>):[string,T][]=>Object.entries(items).sort(([a],[b])=>a.localeCompare(b));

interface BodyPose { id: string; position: Vec3; previousPosition: Vec3; velocity: Vec3; forward: Vec3; radius: number }
export interface AircraftPose extends BodyPose, FlightAircraft { previousQuaternion: Quat; controller: FlightController }
export interface EnemyPose extends BodyPose { quaternion: Quat; yaw: number; targetSpeed: number }
export interface ShipPose extends BodyPose { yaw: number; quaternion: Quat; previousQuaternion: Quat;
  length: number; width: number; height: number; routePhase: number }
export interface WorldState { missionId: string; controlResetVersion: number; controlledAircraftId: string|null;
  aircraft: Record<string, AircraftPose>; enemies: Record<string, EnemyPose>; ships: Record<string, ShipPose> }
export interface TerrainImpact { id: string; kind: 'aircraft' | 'enemy'; t: number; point: Vec3; surface: 'island' | 'sea' }
export interface WorldStep { world: WorldState; mission: MissionState; deaths: DeathBatch; terrainImpacts: TerrainImpact[]; boundaryWarning: boolean }

function seedFraction(seed: number, salt: number): number {
  let v = (seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  v = Math.imul(v ^ (v >>> 16), 0x21f0aaad) >>> 0; v = Math.imul(v ^ (v >>> 15), 0x735a2d97) >>> 0;
  return ((v ^ (v >>> 15)) >>> 0) / 4294967296;
}
export function aircraftSpawnPoint(slot: number, seed: number, candidate = 0): Vec3 {
  const phase = ((slot + candidate) % 8) * Math.PI / 4 + seedFraction(seed, 91) * Math.PI / 4;
  return vec(Math.sin(phase) * 4200, 1000, Math.cos(phase) * 4200);
}
export function enemySpawnPoint(slot: number, seed: number, candidate = 0): Vec3 {
  const phase = ((slot + candidate) % 8) * Math.PI / 4;
  return vec(Math.sin(phase) * 1150, 550 + seedFraction(seed, slot + 17) * 350, Math.cos(phase) * 1150);
}
export function safeAircraftSpawn(slot: number, seed: number): Vec3 {
  for (let candidate = 0; candidate < 8; candidate++) {
    const p = aircraftSpawnPoint(slot, seed, candidate);
    if (!sweepIsland(p, p, AIRCRAFT_RADIUS) && !sweepSea(p, p, AIRCRAFT_RADIUS) && Math.hypot(p.x,p.z) < WORLD_RADIUS) return p;
  }
  throw new Error('Fixed safe spawn points were exhausted');
}
/** Candidates are checked against live bodies; the fixed reserve ID is never consumed here. */
export function findAircraftSpawnPoint(w:WorldState,m:MissionState,slot:number,id?:string):Vec3|null {
  for(let candidate=0;candidate<8;candidate++){
    const p=aircraftSpawnPoint(slot,m.seed,candidate);
    if(sweepIsland(p,p,AIRCRAFT_RADIUS)||sweepSea(p,p)||Math.hypot(p.x,p.z)>=WORLD_RADIUS)continue;
    if(overlapsLiveBody(p,AIRCRAFT_RADIUS,w,m,id,true))continue;return p;
  }
  return null;
}
export function findEnemySpawnPoint(w:WorldState,m:MissionState,slot:number,id?:string):Vec3|null {
  for(let candidate=0;candidate<8;candidate++){
    const p=enemySpawnPoint(slot,m.seed,candidate);
    if(sweepIsland(p,p,ENEMY_RADIUS)||sweepSea(p,p)||Math.hypot(p.x,p.z)>=WORLD_RADIUS)continue;
    // Friendly aircraft are physical spawn exclusions. Warriors never permanently
    // block their own entry outlets, consistent with same-team collision being off.
    if(overlapsLiveBody(p,ENEMY_RADIUS,w,m,id,false))continue;return p;
  }
  return null;
}
function overlapsLiveBody(p:Vec3,radius:number,w:WorldState,m:MissionState,excludeId:string|undefined,includeEnemies:boolean):boolean {
  for(const a of m.aircraft){if(a.status!=='active'||a.id===excludeId)continue;const pose=w.aircraft[a.id];
    if(pose&&distance(p,pose.position)<=radius+pose.radius)return true;}
  if(includeEnemies)for(const e of m.enemies){if(e.status!=='active'||e.id===excludeId)continue;const pose=w.enemies[e.id];
    if(pose&&distance(p,pose.position)<=radius+pose.radius)return true;}
  for(const ship of m.ships){if(ship.status!=='alive')continue;const pose=w.ships[ship.id];
    if(pose&&sweptShipHit(p,p,{...pose,previousPosition:pose.position},radius)!==null)return true;}
  return false;
}
/** Used before the roster completes a reservation. Sequential successes also reserve
 * their candidate positions so multiple arrivals cannot choose the same occupied point. */
export function createSpawnGuard(previous:WorldState):SpawnGuard {
  let planned:WorldState|null=null;
  return (entity,mission)=>{
    // Most ticks have no due reservations. Build the occupancy transaction only
    // when the roster actually asks to admit a new body; state remains immutable.
    planned??=cloneWorld(previous);
    if(planned.missionId!==mission.missionId||entity.slot===null)return false;
    if(entity.id.startsWith('A')){
      const point=findAircraftSpawnPoint(planned,mission,entity.slot,entity.id);if(!point)return false;
      planned.aircraft[entity.id]=spawnAircraft(entity.id,entity.slot,mission.seed,point);return true;
    }
    const point=findEnemySpawnPoint(planned,mission,entity.slot,entity.id);if(!point)return false;
    planned.enemies[entity.id]=spawnEnemy(entity.id,entity.slot,mission.seed,point);return true;
  };
}
function spawnAircraft(id: string, slot: number, seed: number, point?:Vec3): AircraftPose {
  const position = point??safeAircraftSpawn(slot,seed), forward = normalize(vec(-position.x, 0, -position.z));
  const yaw = Math.atan2(-forward.x,-forward.z), quaternion = attitudeQuaternion(0,yaw,0);
  const p = { id, position, previousPosition: {...position}, quaternion, previousQuaternion: {...quaternion},
    yaw, pitch:0, bank:0, speed:110, velocity:scale(forward,110), forward, radius:AIRCRAFT_RADIUS, loopProgress:0,loopCooldown:0 };
  return {...p,controller:createFlightController(p)};
}
function spawnEnemy(id:string,slot:number,seed:number,point?:Vec3):EnemyPose {
  const position=point??enemySpawnPoint(slot,seed),forward=normalize(vec(position.x,0,position.z));
  const targetSpeed=ENEMY_MIN_SPEED+(ENEMY_MAX_SPEED-ENEMY_MIN_SPEED)*seedFraction(seed,Number(id.slice(1))+311);
  const yaw=Math.atan2(-forward.x,-forward.z);
  return {id,position,previousPosition:{...position},velocity:scale(forward,targetSpeed),forward,radius:ENEMY_RADIUS,
    quaternion:attitudeQuaternion(0,yaw,0),yaw,targetSpeed};
}
function shipPose(id:string,radius:number,phase:number):ShipPose {
  const position=vec(Math.cos(phase)*radius,0,Math.sin(phase)*radius),forward=vec(-Math.sin(phase),0,Math.cos(phase));
  const yaw=Math.atan2(-forward.x,-forward.z),quaternion=attitudeQuaternion(0,yaw,0);
  return {id,position,previousPosition:{...position},velocity:scale(forward,6),forward,radius:0,yaw,quaternion,
    previousQuaternion:{...quaternion},routePhase:phase,...CAPITAL_SHIP};
}
export function createWorldState(mission:MissionState):WorldState {
  return syncWorldState({missionId:mission.missionId,controlResetVersion:mission.controlResetVersion,controlledAircraftId:mission.controlledAircraftId,aircraft:{},enemies:{},ships:{}},mission);
}
function cloneWorld(w:WorldState):WorldState {
  const aircraft:Record<string,AircraftPose>={},enemies:Record<string,EnemyPose>={},ships:Record<string,ShipPose>={};
  for(const [id,p]of entriesById(w.aircraft))aircraft[id]={...p,position:{...p.position},previousPosition:{...p.previousPosition},
    velocity:{...p.velocity},forward:{...p.forward},quaternion:{...p.quaternion},previousQuaternion:{...p.previousQuaternion},controller:{...p.controller}};
  for(const [id,p]of entriesById(w.enemies))enemies[id]={...p,position:{...p.position},previousPosition:{...p.previousPosition},
    velocity:{...p.velocity},forward:{...p.forward},quaternion:{...p.quaternion}};
  for(const [id,p]of entriesById(w.ships))ships[id]={...p,position:{...p.position},previousPosition:{...p.previousPosition},
    velocity:{...p.velocity},forward:{...p.forward},quaternion:{...p.quaternion},previousQuaternion:{...p.previousQuaternion}};
  return {...w,aircraft,enemies,ships};
}
export function syncWorldState(previous:WorldState,mission:MissionState):WorldState {
  if(previous.missionId!==mission.missionId)return createWorldState(mission);
  const w=cloneWorld(previous);
  const activeA=new Set(mission.aircraft.filter(a=>a.status==='active').map(a=>a.id));
  const activeE=new Set(mission.enemies.filter(e=>e.status==='active').map(e=>e.id));
  for(const id of Object.keys(w.aircraft))if(!activeA.has(id as never))delete w.aircraft[id];
  for(const id of Object.keys(w.enemies))if(!activeE.has(id as never))delete w.enemies[id];
  for(const s of byId(mission.ships))w.ships[s.id]??=shipPose(s.id,s.routeRadiusM,s.routePhase);
  const aircraftOrder=byId(mission.aircraft).sort((a,b)=>Number(b.id===mission.controlledAircraftId)-Number(a.id===mission.controlledAircraftId));
  for(const a of aircraftOrder)if(a.status==='active'&&!w.aircraft[a.id]){
    const point=findAircraftSpawnPoint(w,mission,a.slot!,a.id);
    if(!point)throw new Error(`Active aircraft ${a.id} has no safe spawn; roster must retain its reservation`);
    w.aircraft[a.id]=spawnAircraft(a.id,a.slot!,mission.seed,point);}
  for(const e of byId(mission.enemies))if(e.status==='active'&&!w.enemies[e.id]){
    const point=findEnemySpawnPoint(w,mission,e.slot!,e.id);
    if(!point)throw new Error(`Active enemy ${e.id} has no safe spawn; roster must retain its reservation`);
    w.enemies[e.id]=spawnEnemy(e.id,e.slot!,mission.seed,point);}
  if(w.controlResetVersion!==mission.controlResetVersion){
    w.controlResetVersion=mission.controlResetVersion;
    const player=mission.controlledAircraftId&&w.aircraft[mission.controlledAircraftId];
    if(player){
      if(w.controlledAircraftId!==mission.controlledAircraftId){player.loopProgress=0;
        player.loopCooldown=Math.max(0,(mission.aircraft.find(a=>a.id===player.id)!.loopCooldownUntilTick-mission.tick)/60);
        player.controller={...createFlightController(player),playerTargetSpeed:player.controller.playerTargetSpeed};}
      else player.controller.loopHeld=false;
    }
    w.controlledAircraftId=mission.controlledAircraftId;
  }
  return w;
}
export function isWorldIceActive(ice:IceState|null,tick:number):boolean {return ice!==null&&ice.startsAtTick<=tick&&tick<ice.expiresAtTick;}
export function worldActualSpeed(base:number,ice:IceState|null,tick:number,kind:'aircraft'|'ship'):number {
  return Math.max(kind==='aircraft'?65:0,base-(isWorldIceActive(ice,tick)?ICE_REDUCTION:0));
}
/** Removes outward displacement only. Attitude and inward/downward controls remain available. */
export function constrainWorldMotion(from:Vec3,to:Vec3):Vec3 {
  let p={...to};
  const r=Math.hypot(p.x,p.z);
  if(r>WORLD_RADIUS){
    const dx=to.x-from.x,dz=to.z-from.z,a=dx*dx+dz*dz,b=2*(from.x*dx+from.z*dz),c=from.x*from.x+from.z*from.z-WORLD_RADIUS**2;
    const disc=b*b-4*a*c,t=a>1e-16&&disc>=0?clamp((-b+Math.sqrt(disc))/(2*a),0,1):0;
    const hit=lerp(from,to,t),normal=normalize(vec(hit.x,0,hit.z)),rest=vec(dx*(1-t),0,dz*(1-t));
    const tangent=sub(rest,scale(normal,Math.max(0,dot(rest,normal))));
    p.x=hit.x+tangent.x;p.z=hit.z+tangent.z;const rr=Math.hypot(p.x,p.z);
    if(rr>WORLD_RADIUS){p.x*=WORLD_RADIUS/rr;p.z*=WORLD_RADIUS/rr;}
  }
  if(p.y>WORLD_CEILING)p.y=WORLD_CEILING;
  return p;
}
export function worldFlightTargets(world:WorldState,mission:MissionState,origin:Vec3):FlightTarget[] {
  return byId(mission.enemies).filter(e=>e.status==='active').flatMap(e=>{
    const p=world.enemies[e.id];return p&&lineOfSight(origin,p.position)?[{id:e.id,position:{...p.position},velocity:{...p.velocity},hp:e.hp}]:[];
  });
}
function nearestEnemy(world:WorldState,origin:Vec3):EnemyPose|undefined {
  let best:EnemyPose|undefined,bestD=Infinity;
  for(const p of byId(Object.values(world.enemies))){const d=distance(origin,p.position);if(d<bestD){best=p;bestD=d;}}
  return best;
}
function wingInput(p:AircraftPose,w:WorldState,tick:number) {
  let target=nearestEnemy(w,p.position)?.position??vec(0,1100,0);
  const radial=Math.hypot(p.position.x,p.position.z),outward=normalize(vec(p.position.x,0,p.position.z));
  if(radial<1350&&p.position.y<1150)target=vec(outward.x*1700,1200,outward.z*1700);
  // Look ahead through the rock rather than waiting for a final contact.
  const lookahead=add(p.position,scale(p.forward,Math.max(600,p.speed*6)));
  if(sweepIsland(p.position,lookahead,100)){
    const tangent=vec(outward.z,0,-outward.x);target=add(vec(outward.x*1700,1150,outward.z*1700),scale(tangent,700));
  }else if(radial>4800||p.position.y>2200)target=vec(outward.x*3000,1200,outward.z*3000);
  else if(distance(p.position,target)<250)target=add(p.position,scale(normalize(sub(p.position,target)),1100));
  if(p.position.y<250)target={...target,y:1000};
  return desiredFlightInput(p,target);
}
function enemyDestination(p:EnemyPose,w:WorldState,mission:MissionState):Vec3 {
  const index=Number(p.id.slice(1));
  const designated=mission.enemies.find(e=>e.id===p.id)?.attackTargetId;
  const target:BodyPose|undefined=designated?(designated.startsWith('S')?w.ships[designated]:w.aircraft[designated]):undefined;
  const ships=byId(mission.ships).filter(s=>s.status==='alive'),ship=ships[(index-1)%Math.max(1,ships.length)];
  const shipTarget=ship?w.ships[ship.id]:null;
  let destination=target?add(target.position,vec(0,designated!.startsWith('S')?200:0,0))
    :shipTarget?add(shipTarget.position,vec(0,180+index%4*50,0)):vec(0,1100,0);
  const radius=Math.hypot(p.position.x,p.position.z),outward=normalize(vec(p.position.x,0,p.position.z));
  if(radius<1300)destination=vec(outward.x*1600,Math.max(600,p.position.y),outward.z*1600);
  else if(sweepIsland(p.position,destination,25)){destination=add(vec(outward.x*1600,1000,outward.z*1600),vec(outward.z*650,0,-outward.x*650));}
  if(distance(p.position,destination)<120){const phase=index*.7+mission.tick/600;
    destination=add(destination,vec(Math.sin(phase)*400,Math.cos(phase*.8)*100+100,Math.cos(phase)*400));}
  if(radius>5200||p.position.y>2250)destination=vec(outward.x*3500,1000,outward.z*3500);
  if(p.position.y<150)destination={...destination,y:500};
  return destination;
}
/** Steering at fixed speed bounds both vector acceleration and angular acceleration. */
export function advanceEnemyVelocity(current:Vec3,desiredDirection:Vec3,dt=FIXED_WORLD_DT):Vec3 {
  const speed=clamp(length(current),ENEMY_MIN_SPEED,ENEMY_MAX_SPEED),from=normalize(current),to=normalize(desiredDirection);
  const a=angle(from,to),limit=Math.min(ENEMY_MAX_TURN_RATE*dt,2*Math.asin(Math.min(1,ENEMY_MAX_ACCELERATION*dt/(2*speed))));
  if(a<1e-10)return scale(to,speed);
  if(a<=limit)return scale(to,speed);
  // Opposite headings need a defined tangent; avoid an undefined sin(pi) path.
  if(Math.PI-a<1e-6){const tangent=normalize(Math.abs(from.y)<.9?vec(-from.z,0,from.x):vec(1,0,0));
    return scale(add(scale(from,Math.cos(limit)),scale(tangent,Math.sin(limit))),speed);}
  return scale(normalize(add(scale(from,Math.sin(a-limit)/Math.sin(a)),scale(to,Math.sin(limit)/Math.sin(a)))),speed);
}
export function stepWorld(previous:WorldState,sourceMission:MissionState,input:FlightInput,mode:GameMode):WorldStep {
  const empty:WorldStep={world:previous,mission:sourceMission,deaths:{missionId:sourceMission.missionId},terrainImpacts:[],boundaryWarning:false};
  if(sourceMission.phase!=='playing'||sourceMission.finalized)return empty;
  const w=syncWorldState(previous,sourceMission),m={...sourceMission,aircraft:byId(sourceMission.aircraft).map(a=>({...a})),
    enemies:byId(sourceMission.enemies).map(e=>({...e,velocity:{...e.velocity}})),ships:byId(sourceMission.ships).map(s=>({...s}))};
  const impacts:TerrainImpact[]=[];
  for(const a of m.aircraft){
    if(a.status!=='active')continue;const p=w.aircraft[a.id];p.previousPosition={...p.position};p.previousQuaternion={...p.quaternion};p.speed=a.baseSpeedMps;
    if(a.id===m.controlledAircraftId){
      const accepted=m.requiresInputRelease?{turn:0,climb:0,fire:false,loop:false,viewAspect:input.viewAspect}:input;
      const targets=worldFlightTargets(w,m,p.position),assist=getFlightAssist(p,targets,accepted,mode),meta=p.controller;
      const slew=(current:number,target:number,rate:number)=>current+clamp(target-current,-rate*FIXED_WORLD_DT,rate*FIXED_WORLD_DT);
      const manual=Math.max(Math.abs(accepted.turn),Math.abs(accepted.climb))>=.35;
      meta.assistTurn=manual?0:slew(meta.assistTurn,assist.turn-accepted.turn,2.5);
      meta.assistClimb=manual?0:slew(meta.assistClimb,assist.climb-accepted.climb,1.5);
      if(meta.assistTurn*accepted.turn<0)meta.assistTurn=0;if(meta.assistClimb*accepted.climb<0)meta.assistClimb=0;
      meta.responseMultiplier=slew(meta.responseMultiplier,assist.responseMultiplier,2.5);
      const adjusted={...accepted,turn:accepted.turn+meta.assistTurn,climb:accepted.climb+meta.assistClimb};
      const pressed=accepted.loop&&!meta.loopHeld;meta.loopHeld=accepted.loop;
      updatePlayerLoop(p,meta,adjusted,accepted,pressed,FIXED_WORLD_DT,advanceThrottle(meta,accepted,mode,FIXED_WORLD_DT),MAX_SPEED,meta.responseMultiplier,
        worldActualSpeed(p.speed,a.ice,m.tick,'aircraft'));
    }else{const ai=wingInput(p,w,m.tick);updateAircraftMotion(p,ai.turn,ai.climb,FIXED_WORLD_DT,CRUISE_SPEED,false,MAX_SPEED,.62,1,
      worldActualSpeed(p.speed,a.ice,m.tick,'aircraft'));}
    a.baseSpeedMps=p.speed;a.actualSpeedMps=worldActualSpeed(p.speed,a.ice,m.tick,'aircraft');p.forward=forwardOf(p);
    p.position=constrainWorldMotion(p.previousPosition,add(p.previousPosition,scale(p.forward,a.actualSpeedMps*FIXED_WORLD_DT)));
    p.velocity=scale(sub(p.position,p.previousPosition),TICKS_PER_SECOND);
    a.loopActive=p.loopProgress>0;a.loopProgress=p.loopProgress;
    a.loopCooldownUntilTick=m.tick+Math.round(p.loopCooldown*TICKS_PER_SECOND);
    const island=sweepIsland(p.previousPosition,p.position,p.radius),sea=sweepSea(p.previousPosition,p.position,0);
    const hit=!island?sea:!sea?island:island.t<=sea.t?island:sea;
    if(hit)impacts.push({id:a.id,kind:'aircraft',t:hit.t,point:hit.point,surface:hit.kind});
  }
  for(const e of m.enemies){
    if(e.status!=='active')continue;const p=w.enemies[e.id];p.previousPosition={...p.position};
    const destination=enemyDestination(p,w,m);p.velocity=advanceEnemyVelocity(p.velocity,sub(destination,p.position));
    p.position=constrainWorldMotion(p.position,add(p.position,scale(p.velocity,FIXED_WORLD_DT)));
    p.velocity=scale(sub(p.position,p.previousPosition),TICKS_PER_SECOND);p.forward=normalize(p.velocity);
    p.yaw=Math.atan2(-p.forward.x,-p.forward.z);p.quaternion=attitudeQuaternion(Math.atan2(p.forward.y,Math.hypot(p.forward.x,p.forward.z)),p.yaw,0);
    e.velocity={...p.velocity};e.entering=Math.hypot(p.position.x,p.position.z)<1200;
    const island=sweepIsland(p.previousPosition,p.position,p.radius),sea=sweepSea(p.previousPosition,p.position,0);
    const hit=!island?sea:!sea?island:island.t<=sea.t?island:sea;
    if(hit)impacts.push({id:e.id,kind:'enemy',t:hit.t,point:hit.point,surface:hit.kind});
  }
  const shipStartPositions=Object.fromEntries(Object.entries(w.ships).map(([id,p])=>[id,{...p.position}]));
  for(const s of m.ships){
    const p=w.ships[s.id];p.previousPosition={...p.position};p.previousQuaternion={...p.quaternion};
    if(s.status!=='alive'){p.velocity=vec();continue;}
    let speed=worldActualSpeed(s.baseSpeedMps,s.ice,m.tick,'ship');
    // Nearby future paths slow a following ship; hull contact never creates damage.
    const proposedPhase=s.routePhase+speed*FIXED_WORLD_DT/s.routeRadiusM;
    const proposed=vec(Math.cos(proposedPhase)*s.routeRadiusM,0,Math.sin(proposedPhase)*s.routeRadiusM);
    for(const other of m.ships){if(other.id===s.id||other.status!=='alive')continue;const otherPosition=shipStartPositions[other.id];
      if(distance(proposed,otherPosition)<CAPITAL_SHIP.length+20&&distance(proposed,otherPosition)<distance(p.position,otherPosition))speed=0;}
    s.actualSpeedMps=speed;s.routePhase+=speed*FIXED_WORLD_DT/s.routeRadiusM;p.routePhase=s.routePhase;
    p.position=vec(Math.cos(s.routePhase)*s.routeRadiusM,0,Math.sin(s.routePhase)*s.routeRadiusM);
    p.forward=vec(-Math.sin(s.routePhase),0,Math.cos(s.routePhase));p.yaw=Math.atan2(-p.forward.x,-p.forward.z);
    p.quaternion=attitudeQuaternion(0,p.yaw,0);p.velocity=scale(sub(p.position,p.previousPosition),TICKS_PER_SECOND);
  }
  const player=m.controlledAircraftId?w.aircraft[m.controlledAircraftId]:null;
  return {world:w,mission:m,deaths:{missionId:m.missionId,aircraftIds:impacts.filter(i=>i.kind==='aircraft').map(i=>i.id as never),
    enemyIds:impacts.filter(i=>i.kind==='enemy').map(i=>i.id as never)},terrainImpacts:impacts,
    boundaryWarning:Boolean(player&&(Math.hypot(player.position.x,player.position.z)>=WORLD_WARNING_RADIUS||player.position.y>=WORLD_WARNING_CEILING))};
}
