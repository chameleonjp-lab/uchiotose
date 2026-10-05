import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMissionState,beginMissionTick,completeMissionTick,setMissionPhase,acknowledgeInputRelease } from '../src/roster';
import { createWorldState,stepWorld,syncWorldState,constrainWorldMotion,safeAircraftSpawn,enemySpawnPoint,
  advanceEnemyVelocity,worldActualSpeed,worldFlightTargets,sweptShipHit,interceptDirection,segmentSphereHit,
  createSpawnGuard,findAircraftSpawnPoint,findEnemySpawnPoint,aircraftSpawnPoint,
  type WorldState,type FlightInput } from '../src/world';
import { ISLAND_VERTICES,ISLAND_TRIANGLES,ISLAND_PLANES,sweepIsland,sweepSea,lineOfSight } from '../src/island';
import { vec,length,sub,distance,angle,attitudeQuaternion,transformDirection } from '../src/world-math';
import { createFlightController,updatePlayerLoop,advanceThrottle,updateQuaternion } from '../src/flight';
import { applyEasyShotCorrection,autoFireTarget } from '../src/flight-assist';
import { getFlightCameraPose,projectFlightTarget } from '../src/flight-view';
import { projectGunSight } from '../src/gun-sight';
import { WarriorVisualFactory } from '../src/warrior-visual';
import { Box3,Vector3 } from 'three';
const neutral:FlightInput={turn:0,climb:0,fire:false,loop:false};
const close=(actual:number,expected:number,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
function activeMission(){const m=createMissionState({missionId:'world-test',seed:20261005,phase:'playing'});
  return acknowledgeInputRelease(m,m.missionId,m.controlResetVersion);}

test('island is one closed watertight mesh with the exact 1 km/300-800 m envelope',()=>{
  const edges=new Map<string,number>();
  for(let i=0;i<ISLAND_TRIANGLES.length;i+=3)for(let e=0;e<3;e++){
    const a=ISLAND_TRIANGLES[i+e],b=ISLAND_TRIANGLES[i+(e+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(':');edges.set(key,(edges.get(key)??0)+1);}
  for(const count of edges.values())assert.equal(count,2);
  close(Math.max(...ISLAND_VERTICES.map(p=>Math.hypot(p.x,p.z))),1000);
  assert.equal(Math.min(...ISLAND_VERTICES.map(p=>p.y)),300);assert.equal(Math.max(...ISLAND_VERTICES.map(p=>p.y)),800);
  for(const p of ISLAND_VERTICES)for(const plane of ISLAND_PLANES)assert.ok(plane.normal.x*p.x+plane.normal.y*p.y+plane.normal.z*p.z<=plane.limit+1e-7);
});
test('island sweeps hit the top, underside, side, overhanging rim and both back faces',()=>{
  const top=sweepIsland(vec(0,1200,0),vec(0,600,0))!;close(top.t,2/3);close(top.point.y,800);assert.ok(top.normal.y>0);
  const underside=sweepIsland(vec(0,100,0),vec(0,550,0))!;close(underside.point.y,300);assert.ok(underside.normal.y<0);
  for(const sign of [-1,1])for(const axis of ['x','z'] as const){const from=vec(0,700,0),to=vec(0,700,0);from[axis]=sign*2000;to[axis]=-sign*2000;
    const hit=sweepIsland(from,to)!;close(hit.t,.25);close(Math.abs(hit.point[axis]),1000);}
  assert.ok(sweepIsland(vec(980,900,0),vec(980,600,0)));assert.equal(sweepIsland(vec(1050,900,0),vec(1050,600,0)),null);
});
test('high speed, oblique, initial overlap, very short segment and rim endpoints resolve once',()=>{
  close(sweepIsland(vec(-10000,700,0),vec(10000,700,0))!.t,.45);
  assert.ok(sweepIsland(vec(-2000,900,-300),vec(2000,500,300)));
  assert.equal(sweepIsland(vec(0,550,0),vec(0,550,0))!.t,0);
  assert.equal(sweepIsland(vec(2000,500,0),vec(2000.00000001,500,0)),null);
  assert.equal(sweepIsland(vec(1000,700,0),vec(1000,700,0))!.t,0);
  assert.equal(sweepIsland(vec(0,550,0),vec(0,550,0),-1),null);
});
test('island sight blocks a whole crossing and preserves top/bottom attack routes',()=>{
  assert.equal(lineOfSight(vec(-2000,600,0),vec(2000,600,0)),false);
  assert.equal(lineOfSight(vec(-2000,1100,0),vec(2000,1100,0)),true);
  assert.equal(lineOfSight(vec(-2000,100,0),vec(2000,100,0)),true);
  assert.equal(sweepSea(vec(0,3,0),vec(0,-3,0))!.t,.5);
});
test('all deterministic aircraft waiting points and enemy outlets are safe and within range',()=>{
  for(const seed of [0,1,20261005,-1234])for(let slot=0;slot<24;slot++){
    const a=safeAircraftSpawn(slot%8,seed),e=enemySpawnPoint(slot,seed);
    assert.deepEqual(a,safeAircraftSpawn(slot%8,seed));close(Math.hypot(a.x,a.z),4200);
    assert.equal(a.y,1000);assert.equal(sweepIsland(a,a,6),null);assert.equal(sweepSea(a,a),null);
    close(Math.hypot(e.x,e.z),1150);assert.ok(e.y>=550&&e.y<=900);assert.equal(sweepIsland(e,e,2.5),null);}
});
test('boundary cancels outward/upward displacement but accepts inward/downward flight',()=>{
  const inward=vec(5998,2498,0);assert.deepEqual(constrainWorldMotion(vec(6000,2500,0),inward),inward);
  const outward=constrainWorldMotion(vec(5999,2499,0),vec(6001,2501,1));close(Math.hypot(outward.x,outward.z),6000);assert.equal(outward.y,2500);assert.ok(outward.z>0);
  const m=activeMission(),w=createWorldState(m),p=w.aircraft.A001;p.position=vec(6000,2500,0);p.previousPosition={...p.position};p.yaw=-Math.PI/2;p.pitch=.4;updateQuaternion(p);
  const next=stepWorld(w,beginMissionTick(m),neutral,'normal');assert.equal(next.boundaryWarning,true);assert.equal(next.terrainImpacts.length,0);
});
test('enemy 3D steering respects 10/60 km/h, 8 m/s² and 120 degrees/s at both ends',()=>{
  for(const speed of [10/3.6,60/3.6]){let velocity=vec(0,0,-speed);
    for(let i=0;i<240;i++){const desired=vec(Math.sin(i*.017)+.2,Math.cos(i*.027)*.7,.4);
      const next=advanceEnemyVelocity(velocity,desired);close(length(next),speed,1e-8);
      assert.ok(length(sub(next,velocity))<=8/60+1e-9);assert.ok(angle(velocity,next)<=120*Math.PI/180/60+1e-9);velocity=next;}
    assert.ok(Math.abs(velocity.y)>.1);assert.ok(Math.abs(velocity.x)>.1);}
});
test('ice applies once to displacement and real-speed turn authority while preserving baseline trim',()=>{
  const m=activeMission(),w=createWorldState(m);m.tick=1;m.aircraft[0].ice={startsAtTick:1,expiresAtTick:301};
  const frozen=stepWorld(w,m,{...neutral,turn:.5},'normal');
  const normalMission=structuredClone(m);normalMission.aircraft[0].ice=null;const normal=stepWorld(w,normalMission,{...neutral,turn:.5},'normal');
  close(frozen.mission.aircraft[0].baseSpeedMps,normal.mission.aircraft[0].baseSpeedMps);
  close(frozen.mission.aircraft[0].actualSpeedMps,frozen.mission.aircraft[0].baseSpeedMps-50/3.6);
  close(distance(frozen.world.aircraft.A001.position,w.aircraft.A001.position),frozen.mission.aircraft[0].actualSpeedMps/60,1e-7);
  assert.notEqual(frozen.world.aircraft.A001.yaw,normal.world.aircraft.A001.yaw);
  close(worldActualSpeed(110,m.aircraft[0].ice,1,'aircraft'),346/3.6);assert.equal(worldActualSpeed(65,m.aircraft[0].ice,1,'aircraft'),65);
  assert.equal(worldActualSpeed(110,m.aircraft[0].ice,301,'aircraft'),110);
});
test('ship ice freezes the same route phase and releases without repair or a warp',()=>{
  const m=activeMission(),w=createWorldState(m);m.tick=1;m.ships[0].ice={startsAtTick:1,expiresAtTick:301};
  const frozen=stepWorld(w,m,neutral,'normal');assert.deepEqual(frozen.world.ships.S001.position,w.ships.S001.position);
  assert.equal(frozen.mission.ships[0].routePhase,m.ships[0].routePhase);assert.equal(frozen.mission.ships[0].actualSpeedMps,0);
  const expired={...frozen.mission,tick:301};const moving=stepWorld(frozen.world,expired,neutral,'normal');
  close(distance(moving.world.ships.S001.position,w.ships.S001.position),.1,1e-9);assert.equal(moving.mission.ships[0].hp,1200);
});
test('a following ship slows near a stopped hull; sinking excludes it from avoidance',()=>{
  const m=activeMission();m.ships[1].routeRadiusM=m.ships[0].routeRadiusM;m.ships[1].routePhase=.12;
  m.ships[1].ice={startsAtTick:0,expiresAtTick:300};const w=createWorldState(m),first=stepWorld(w,m,neutral,'normal');
  assert.equal(first.mission.ships[0].actualSpeedMps,0);
  m.ships[1].status='sunk';m.ships[1].hp=0;const next=stepWorld(w,m,neutral,'normal');assert.equal(next.mission.ships[0].actualSpeedMps,6);
});
test('world reducer does not mutate inputs, ignores stopped phases, and normalizes entity order',()=>{
  let m=activeMission(),w=createWorldState(m);const copy=structuredClone({w,m});const step=stepWorld(w,beginMissionTick(m),neutral,'normal');assert.deepEqual({w,m},copy);
  for(const phase of ['home','paused','result'] as const){const stopped={...m,phase};const result=stepWorld(w,stopped,neutral,'normal');assert.equal(result.world,w);assert.equal(result.mission,stopped);}
  let reversed=structuredClone(m);reversed.aircraft.reverse();reversed.enemies.reverse();reversed.ships.reverse();let reversedWorld=createWorldState(reversed);
  for(let i=0;i<650;i++){m=beginMissionTick(m);reversed=beginMissionTick(reversed);const a=stepWorld(w,m,neutral,'normal'),b=stepWorld(reversedWorld,reversed,neutral,'normal');
    assert.deepEqual(a.world,b.world);assert.deepEqual(a.mission,b.mission);w=a.world;m=a.mission;reversedWorld=b.world;reversed=b.mission;}
  assert.ok(step.world.aircraft.A001);
});
test('pause resumes the same loop; a real control handoff cancels only the new owner loop',()=>{
  let m=activeMission(),w=createWorldState(m);m=beginMissionTick(m);let result=stepWorld(w,m,{...neutral,loop:true},'normal');w=result.world;m=result.mission;
  const progress=w.aircraft.A001.loopProgress;assert.ok(progress>0);
  const paused=setMissionPhase(m,'paused');assert.equal(stepWorld(w,paused,neutral,'normal').world,w);
  const resumed=setMissionPhase(paused,'playing');w=syncWorldState(w,resumed);assert.equal(w.aircraft.A001.loopProgress,progress);
  result=stepWorld(w,beginMissionTick(resumed),neutral,'normal');assert.ok(result.world.aircraft.A001.loopProgress>progress);
  const handoff={...resumed,controlledAircraftId:'A002' as const,controlResetVersion:resumed.controlResetVersion+1};
  w.aircraft.A002.loopProgress=.4;w.aircraft.A002.controller.playerLoopActive=true;const changed=syncWorldState(w,handoff);
  assert.equal(changed.aircraft.A002.loopProgress,0);assert.equal(changed.aircraft.A001.loopProgress,progress);
});
test('fixed-source aerodynamic golden traces cover throttle, steering, complete/interrupted loops',()=>{
  const golden=JSON.parse(fs.readFileSync(new URL('./fixtures/kaisen-flight.json',import.meta.url),'utf8'));
  assert.equal(golden.commit,'3d751051dc6212482a129e8da596ddd349b2f9f5');
  for(const c of golden.cases){const p={position:vec(2800,1000,2300),quaternion:attitudeQuaternion(0,.3,0),yaw:.3,pitch:0,bank:0,speed:110,loopProgress:0,loopCooldown:0};
    const meta=createFlightController(p);let sample=0;
    for(let tick=1;tick<=c.ticks;tick++){const input={...c.input,turn:tick>=c.interruptAt&&c.interruptAt>0?.42:c.input.turn,fire:false,loop:tick===c.loopAt};
      updatePlayerLoop(p,meta,input,input,input.loop,1/60,advanceThrottle(meta,input,'normal',1/60),141,1);
      if(tick%60===0){const expected=c.samples[sample++];for(const key of ['yaw','pitch','bank','speed','loopProgress','loopCooldown'] as const)close(p[key],expected[key],1e-9);
        for(const axis of ['x','y','z'] as const)close(p.position[axis],expected.position[axis],1e-8);
        for(const axis of ['x','y','z','w'] as const)close(p.quaternion[axis],expected.quaternion[axis],1e-9);}}
  }
});
test('actual free-flight velocity is used for a lifetime-limited intercept',()=>{
  const origin=vec(0,1000,0),target=vec(0,1000,-500),velocity=vec(16,4,0),d=interceptDirection(origin,target,velocity,820,1.5);
  assert.ok(d.x>0&&d.y>0);close(length(d),1);const flightTime=500/(-d.z*820);
  close(d.x*820*flightTime,velocity.x*flightTime);close(d.y*820*flightTime,velocity.y*flightTime);
  assert.deepEqual(interceptDirection(origin,vec(0,1000,-5000),velocity,200,1,vec(0,0,-1)),vec(0,0,-1));
});
test('Easy shot correction retains 35%, 0.028 rad and 0.16 rad gates; Normal bore remains fixed',()=>{
  const forward=vec(0,0,-1);close(angle(forward,applyEasyShotCorrection(forward,vec(Math.sin(.04),0,-Math.cos(.04)))),.04*.35);
  close(angle(forward,applyEasyShotCorrection(forward,vec(Math.sin(.14),0,-Math.cos(.14)))),.028);
  assert.deepEqual(applyEasyShotCorrection(forward,vec(Math.sin(.17),0,-Math.cos(.17))),forward);
  const p=createWorldState(activeMission()).aircraft.A001;const position=addAhead(p.position,transformDirection(vec(0,0,-1),p.quaternion),500);
  const target={id:'E001',position,velocity:vec(),hp:80};assert.equal(autoFireTarget(p,[target],'normal',1),null);assert.ok(autoFireTarget(p,[target],'easy',1));
  const sight=projectGunSight(p,393,648);assert.ok(Number.isFinite(sight.x)&&Number.isFinite(sight.y));
});
function addAhead(origin:{x:number;y:number;z:number},forward:{x:number;y:number;z:number},d:number){return vec(origin.x+forward.x*d,origin.y+forward.y*d,origin.z+forward.z*d);}
test('island-hidden enemies cannot influence Easy assistance or auto-fire candidates',()=>{
  const m=activeMission(),w=createWorldState(m);w.aircraft.A001.position=vec(-1600,600,0);w.enemies.E001.position=vec(1600,600,0);
  assert.equal(worldFlightTargets(w,m,w.aircraft.A001.position).some(e=>e.id==='E001'),false);
});
test('swept hull has the same dimensions as drawing and excludes empty sea beside the ship',()=>{
  const p=createWorldState(activeMission()).ships.S001;
  const local=(v:{x:number;y:number;z:number})=>{const r=transformDirection(v,p.quaternion);return vec(p.position.x+r.x,p.position.y+r.y,p.position.z+r.z);};
  assert.ok(sweptShipHit(local(vec(0,5,-500)),local(vec(0,5,500)),p)!>=0);
  assert.equal(sweptShipHit(local(vec(50,5,-500)),local(vec(50,5,500)),p),null);
  assert.equal(sweptShipHit(local(vec(10,40,-500)),local(vec(10,40,500)),p),null);
  const sphere=segmentSphereHit(vec(-10,0,0),vec(10,0,0),vec(),2.5);close(sphere!,.375);
});
test('original warrior neutral appearance measures four metres tall and eight across',()=>{
  const factory=new WarriorVisualFactory(),visual=factory.create();visual.root.updateMatrixWorld(true);
  const size=new Box3().setFromObject(visual.root).getSize(new Vector3());close(size.x,8,1e-6);close(size.y,4,1e-6);
  factory.dispose();
});
function pendingEnemy(){let m=activeMission(),w=createWorldState(m);
  m=completeMissionTick(m,{missionId:m.missionId,enemyIds:['E001']});w=syncWorldState(w,m);
  for(let i=0;i<119;i++){m=beginMissionTick(m,createSpawnGuard(w));w=syncWorldState(w,m);}
  return{m,w};}
test('enemy arrival skips an outlet occupied by an aircraft and uses the same guarded candidate',()=>{
  const {m,w}=pendingEnemy(),pending=m.enemies.find(e=>e.status==='pending')!,blocked=enemySpawnPoint(pending.slot!,m.seed);
  w.aircraft.A001.position=blocked;w.aircraft.A001.previousPosition={...blocked};
  const expected=findEnemySpawnPoint(w,m,pending.slot!,pending.id)!;assert.ok(distance(expected,blocked)>100);
  const ready=beginMissionTick(m,createSpawnGuard(w)),next=syncWorldState(w,ready);
  assert.equal(ready.enemies.find(e=>e.id===pending.id)!.status,'active');assert.deepEqual(next.enemies[pending.id].position,expected);
  assert.ok(distance(next.enemies[pending.id].position,w.aircraft.A001.position)>8.5);
});
test('all eight enemy outlets occupied retains the same pending ID/deadline until a point opens',()=>{
  let {m,w}=pendingEnemy();const pending=m.enemies.find(e=>e.status==='pending')!,id=pending.id,due=pending.reservation!.dueTick;
  for(let i=0;i<8;i++){const p=enemySpawnPoint(pending.slot!,m.seed,i);w.aircraft[`A00${i+1}`].position=p;w.aircraft[`A00${i+1}`].previousPosition={...p};}
  assert.equal(findEnemySpawnPoint(w,m,pending.slot!,id),null);
  for(let i=0;i<5;i++){m=beginMissionTick(m,createSpawnGuard(w));w=syncWorldState(w,m);const kept=m.enemies.find(e=>e.id===id)!;
    assert.equal(kept.status,'pending');assert.equal(kept.reservation!.dueTick,due);assert.equal(w.enemies[id],undefined);}
  w.aircraft.A001.position.x+=100;const ready=beginMissionTick(m,createSpawnGuard(w));w=syncWorldState(w,ready);
  assert.equal(ready.enemies.find(e=>e.id===id)!.status,'active');assert.ok(w.enemies[id]);assert.equal(ready.losses.enemies,1);
});
test('aircraft arrivals skip occupied friendly/enemy bodies and actual hull volume',()=>{
  const m=activeMission(),w=createWorldState(m),slot=0,original=aircraftSpawnPoint(slot,m.seed);
  w.enemies.E001.position={...original};w.aircraft.A002.position.x+=100;
  const candidate=findAircraftSpawnPoint(w,m,slot,'A009')!;assert.ok(candidate);assert.ok(distance(candidate,original)>100);
  assert.ok(distance(candidate,w.aircraft.A002.position)>12);
  for(const p of Object.values(w.aircraft))p.position=vec(0,1000,5000);for(const p of Object.values(w.enemies))p.position=vec(0,1200,1200);
  w.ships.S001.position={...original};w.ships.S001.previousPosition={...original};
  assert.ok(distance(findAircraftSpawnPoint(w,m,slot,'A009')!,original)>100);
});
test('blocked aircraft reservation keeps its finite ID/expiry and completes when the exclusion moves',()=>{
  let m=activeMission(),w=createWorldState(m);m=completeMissionTick(m,{missionId:m.missionId,aircraftIds:['A001']});w=syncWorldState(w,m);
  const pending=m.aircraft.find(a=>a.status==='pending')!,id=pending.id,due=pending.reservation!.dueTick;
  for(let i=0;i<8;i++)w.enemies[`E00${i+1}`].position=aircraftSpawnPoint(pending.slot!,m.seed,i);
  for(let i=0;i<184;i++){m=beginMissionTick(m,createSpawnGuard(w));w=syncWorldState(w,m);}
  const kept=m.aircraft.find(a=>a.id===id)!;assert.equal(kept.status,'pending');assert.equal(kept.reservation!.dueTick,due);
  w.enemies.E001.position.y+=100;w.aircraft.A002.position.x+=100;
  m=beginMissionTick(m,createSpawnGuard(w));w=syncWorldState(w,m);assert.equal(m.aircraft.find(a=>a.id===id)!.status,'active');assert.ok(w.aircraft[id]);
  assert.equal(m.losses.player,1);assert.equal(m.aircraft.filter(a=>a.status==='lost').length,1);
});
test('simultaneous guarded reservations and record/pending array order use identical candidates',()=>{
  let m=activeMission(),w=createWorldState(m);m=completeMissionTick(m,{missionId:m.missionId,aircraftIds:['A001','A002','A003'],enemyIds:['E001','E002']});w=syncWorldState(w,m);
  let reversed=structuredClone(m),rw=structuredClone(w);reversed.aircraft.reverse();reversed.enemies.reverse();reversed.ships.reverse();
  rw.aircraft=Object.fromEntries(Object.entries(rw.aircraft).reverse());rw.enemies=Object.fromEntries(Object.entries(rw.enemies).reverse());
  for(let i=0;i<180;i++){m=beginMissionTick(m,createSpawnGuard(w));w=syncWorldState(w,m);reversed=beginMissionTick(reversed,createSpawnGuard(rw));rw=syncWorldState(rw,reversed);}
  assert.deepEqual(w,rw);for(const id of ['A009','A010','A011'])assert.ok(w.aircraft[id]);
  assert.deepEqual(w.enemies.E025.position,rw.enemies.E025.position);assert.deepEqual(w.enemies.E026.position,rw.enemies.E026.position);
  assert.ok(distance(w.aircraft.A009.position,w.aircraft.A010.position)>12);assert.ok(distance(w.aircraft.A010.position,w.aircraft.A011.position)>12);
});
