import {
  acknowledgeInputRelease, assertRosterInvariants, beginMissionTick, completeMissionTick,
  createMissionState, resetMission, setMissionPhase,
  type AircraftId, type EnemyId, type MissionOptions, type MissionState, type ShipId,
} from './roster';
import {
  createWorldState, createSpawnGuard, syncWorldState, stepWorld, lineOfSight, interceptDirection, transformDirection,
  type Vec3, type WorldState,
} from './world';
import type { FlightAircraft, FlightInput, FlightTarget, GameMode } from './flight-types';
import { autoFireTarget, applyEasyShotCorrection } from './flight-assist';
import { aircraftDamageMultiplier } from './aircraft-damage';
import { consumeAircraftVolley, consumeMagicRound, consumeShipRound, updateReloads } from './ammunition';
import { assignAttackSlots, createAttackBudget, type AttackBudgetState, type AttackCandidate, type AttackTarget } from './attack-budget';
import { addBurn, applyIceHit, BURN_CAPACITY, expireIce, integrateBurns } from './status-effects';
import {
  advanceProjectiles, FIXED_DT, makeProjectile, PROJECTILE_CAPACITIES, projectileCounts,
  type PoolCapacities, type Projectile, type ProjectileImpact, type ProjectileKind,
} from './projectiles';
import {
  createResultSnapshot, createScoreLedger, recordEnemyDamage, scoreBreakdown,
  type ResultSnapshot, type ScoreBreakdown, type ScoreLedger,
} from './scoring';

export { FIXED_DT } from './projectiles';
export type { FlightInput, GameMode } from './flight-types';
export const MAX_TICK_EVENTS = 1024;

export interface SimulationEvent {
  id: string;
  type: 'shot' | 'hit' | 'fire-hit' | 'ice-hit' | 'burn' | 'terrain-impact' | 'death' | 'respawn'
    | 'reload-start' | 'reload-complete' | 'handoff' | 'end';
  position: Vec3;
  ownerId?: string;
  targetId?: string;
  kind?: ProjectileKind;
  damage?: number;
  timeSeconds?: number;
}
export interface SimulationMetrics {
  poolBlockedAircraft: number;
  poolBlockedMagic: number;
  poolBlockedAntiAir: number;
  maxAircraftProjectiles: number;
  maxMagicProjectiles: number;
  maxAntiAirProjectiles: number;
  maxBurns: number;
  maxEvents: number;
  aircraftShots: number;
  enemyShots: number;
  shipShots: number;
}
export interface SimulationState {
  mission: MissionState;
  world: WorldState;
  mode: GameMode;
  projectiles: Projectile[];
  combat: AttackBudgetState;
  nextProjectileOrdinal: number;
  poolCapacities: PoolCapacities;
  score: ScoreLedger;
  result: ResultSnapshot | null;
  events: SimulationEvent[];
  metrics: SimulationMetrics;
  boundaryWarning: boolean;
}
export interface SimulationOptions extends MissionOptions {
  mode?: GameMode;
  poolCapacities?: Partial<PoolCapacities>;
}
export interface TerrainImpact {
  id: string;
  kind: 'aircraft' | 'enemy';
  t: number;
  point: Vec3;
  surface: 'sea' | 'island';
}

const ZERO_INPUT: FlightInput = { turn: 0, climb: 0, fire: false, loop: false };
const ZERO_POSITION: Vec3 = { x: 0, y: 0, z: 0 };
const distance = (left: Vec3, right: Vec3) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
const dot = (left: Vec3, right: Vec3) => left.x * right.x + left.y * right.y + left.z * right.z;
const add = (left: Vec3, right: Vec3): Vec3 => ({ x: left.x + right.x, y: left.y + right.y, z: left.z + right.z });

export function createSimulation(options: SimulationOptions): SimulationState {
  const mission = createMissionState(options);
  const poolCapacities = { ...PROJECTILE_CAPACITIES, ...options.poolCapacities };
  for (const capacity of Object.values(poolCapacities)) {
    if (!Number.isSafeInteger(capacity) || capacity < 0) throw new RangeError('Invalid logical projectile capacity');
  }
  return {
    mission, world: createWorldState(mission), mode: options.mode ?? 'normal', projectiles: [],
    combat: createAttackBudget(), nextProjectileOrdinal: 1, poolCapacities,
    score: createScoreLedger(mission), result: null, events: [], boundaryWarning: false,
    metrics: {
      poolBlockedAircraft: 0, poolBlockedMagic: 0, poolBlockedAntiAir: 0,
      maxAircraftProjectiles: 0, maxMagicProjectiles: 0, maxAntiAirProjectiles: 0,
      maxBurns: 0, maxEvents: 0, aircraftShots: 0, enemyShots: 0, shipShots: 0,
    },
  };
}

export function resetSimulation(previous: SimulationState, options: SimulationOptions): SimulationState {
  const mission = resetMission(previous.mission, options);
  const next = createSimulation({ seed: previous.mission.seed, phase: 'playing', mode: previous.mode, ...options });
  return { ...next, mission, world: createWorldState(mission) };
}

export function setSimulationPhase(state: SimulationState, phase: 'home' | 'paused' | 'playing'): SimulationState {
  const mission = setMissionPhase(state.mission, phase);
  return mission === state.mission ? state : { ...state, mission, world: syncWorldState(state.world, mission), events: [] };
}

export function releaseSimulationInput(
  state: SimulationState, missionId = state.mission.missionId, resetVersion = state.mission.controlResetVersion,
): SimulationState {
  const mission = acknowledgeInputRelease(state.mission, missionId, resetVersion);
  return mission === state.mission ? state : { ...state, mission };
}

export function getSimulationScore(state: SimulationState): ScoreBreakdown {
  return state.result?.breakdown ?? scoreBreakdown(state.score, state.mission.losses, state.mission.tick / 60);
}

function effectDeadlines(mission: MissionState): MissionState {
  return {
    ...mission,
    aircraft: mission.aircraft.map(item => ({ ...item, ice: expireIce(item.ice, mission.tick) })),
    ships: mission.ships.map(item => ({ ...item, ice: expireIce(item.ice, mission.tick) })),
  };
}

function poseFor(world: WorldState, id: string) {
  return world.aircraft[id] ?? world.enemies[id] ?? world.ships[id];
}

function eligibleAttacks(mission: MissionState, world: WorldState) {
  const targets: AttackTarget[] = [
    ...mission.aircraft.filter(item => item.status === 'active').map(item => ({ id: item.id, kind: 'aircraft' as const })),
    ...mission.ships.filter(item => item.status === 'alive').map(item => ({ id: item.id, kind: 'ship' as const })),
  ];
  const enemies: AttackCandidate[] = mission.enemies.filter(enemy => enemy.status === 'active' && !enemy.entering
    && enemy.ammunition > 0 && enemy.reloadUntilTick === null).map(enemy => {
    const origin = world.enemies[enemy.id].position;
    return { id: enemy.id, targetIds: targets.filter(target => {
      const targetPose = poseFor(world, target.id)!;
      const point = target.kind === 'ship' ? add(targetPose.position, { x: 0, y: world.ships[target.id].height * 0.4, z: 0 }) : targetPose.position;
      return distance(origin, point) <= 1200 && lineOfSight(origin, point);
    }).map(target => target.id) };
  });
  const ships: AttackCandidate[] = mission.ships.filter(ship => ship.status === 'alive'
    && ship.ammunition > 0 && ship.reloadUntilTick === null).map(ship => {
    const pose = world.ships[ship.id];
    const origin = add(pose.position, { x: 0, y: pose.height * 0.6, z: 0 });
    return { id: ship.id, targetIds: mission.enemies.filter(enemy => enemy.status === 'active'
      && distance(origin, world.enemies[enemy.id].position) <= 900 && lineOfSight(origin, world.enemies[enemy.id].position))
      .sort((left, right) => distance(origin, world.enemies[left.id].position) - distance(origin, world.enemies[right.id].position)
        || left.id.localeCompare(right.id)).map(enemy => enemy.id) };
  });
  return { enemies, ships, targets };
}

function appendEvent(events: SimulationEvent[], event: SimulationEvent): void {
  if (events.length >= MAX_TICK_EVENTS) throw new Error('Logical tick event capacity exhausted');
  events.push(event);
}

/** All emissions use tick-start living entities; no collision has yet changed HP. */
function emitProjectiles(state: SimulationState, mission: MissionState, world: WorldState, input: FlightInput, mode: GameMode) {
  const events: SimulationEvent[] = [];
  const projectiles = state.projectiles.filter(projectile => projectile.missionId === mission.missionId).slice();
  const counts = projectileCounts(projectiles);
  const metrics = { ...state.metrics };
  let ordinal = state.nextProjectileOrdinal;
  const eligible = eligibleAttacks(mission, world);
  const combat = assignAttackSlots(state.combat, mission.tick, eligible.enemies, mission.enemies.map(item => item.id), eligible.targets,
    eligible.ships, mission.ships.map(item => item.id));
  mission = {
    ...mission,
    aircraft: mission.aircraft.slice(),
    enemies: mission.enemies.map(enemy => ({ ...enemy, attackTargetId: combat.enemyOwners.find(owner => owner.ownerId === enemy.id)?.targetId as AircraftId | ShipId ?? null })),
    ships: mission.ships.map(ship => ({ ...ship, ownsAttackSlot: combat.shipOwners.some(owner => owner.ownerId === ship.id) })),
  };
  function append(projectile: Projectile): void {
    projectiles.push(projectile);
    appendEvent(events, { id: `${projectile.id}:shot`, type: 'shot', position: projectile.position, ownerId: projectile.ownerId, kind: projectile.kind });
  }
  for (const aircraftId of mission.aircraft.map(item => item.id).sort()) {
    const index = mission.aircraft.findIndex(item => item.id === aircraftId);
    const aircraft = mission.aircraft[index];
    const pose = world.aircraft[aircraft.id];
    if (aircraft.status !== 'active' || aircraft.hp <= 0 || !pose) continue;
    const visibleTargets: FlightTarget[] = mission.enemies.filter(enemy => enemy.status === 'active'
      && lineOfSight(pose.position, world.enemies[enemy.id].position)).map(enemy => ({
      id: enemy.id, hp: enemy.hp, position: world.enemies[enemy.id].position, velocity: world.enemies[enemy.id].velocity,
    }));
    const flightAircraft: FlightAircraft = {
      position: pose.position, quaternion: pose.quaternion, yaw: pose.yaw, pitch: pose.pitch, bank: pose.bank,
      speed: aircraft.baseSpeedMps, loopProgress: aircraft.loopProgress, loopCooldown: Math.max(0, aircraft.loopCooldownUntilTick - mission.tick) / 60,
    };
    const autoTarget = aircraft.role === 'player' ? autoFireTarget(flightAircraft, visibleTargets, mode, input.viewAspect) : null;
    const wingTarget = aircraft.role === 'wing' ? visibleTargets.filter(target => distance(pose.position, target.position) <= 1200)
      .map(target => ({ target, direction: interceptDirection(pose.position, target.position, target.velocity, aircraft.actualSpeedMps + 820, 1.5, pose.forward) }))
      .filter(item => dot(pose.forward, item.direction) >= Math.cos(0.16))
      .sort((left, right) => distance(pose.position, left.target.position) - distance(pose.position, right.target.position)
        || left.target.id.localeCompare(right.target.id))[0]?.target ?? null : null;
    const target = aircraft.role === 'player' ? autoTarget : wingTarget;
    const firing = aircraft.role === 'player' ? !mission.requiresInputRelease && (mode === 'easy' ? autoTarget !== null : input.fire) : wingTarget !== null;
    if (!firing) continue;
    for (const kind of ['mg', 'cannon'] as const) {
      const before = mission.aircraft[index];
      const volley = consumeAircraftVolley(before, kind, mission.tick, state.poolCapacities.aircraft - counts.aircraft);
      if (volley.poolBlocked) { metrics.poolBlockedAircraft += 1; continue; }
      if (volley.rounds === 0) continue;
      mission.aircraft[index] = volley.aircraft;
      counts.aircraft += volley.rounds; metrics.aircraftShots += volley.rounds;
      for (let barrel = 0; barrel < volley.rounds; barrel += 1) {
        const side = barrel === 0 ? -1 : 1;
        const offset = kind === 'mg' ? { x: side * 0.3, y: 0.52, z: -4.25 } : { x: side * 2.5, y: 0, z: -2.4 };
        const origin = add(pose.position, transformDirection(offset, pose.quaternion));
        const speed = aircraft.actualSpeedMps + (kind === 'mg' ? 820 : 700);
        const predicted = target ? interceptDirection(origin, target.position, target.velocity, speed, 1.5, pose.forward) : pose.forward;
        const gated = dot(pose.forward, predicted) >= Math.cos(0.16) ? predicted : pose.forward;
        const direction = aircraft.role === 'player' ? mode === 'easy' ? applyEasyShotCorrection(pose.forward, gated) : pose.forward : gated;
        append(makeProjectile(mission.missionId, ordinal++, aircraft.id, aircraft.role!, kind, mission.tick, origin, direction, speed, volley.damage));
      }
      if (before.reloadUntilTick === null && volley.aircraft.reloadUntilTick !== null) {
        appendEvent(events, { id: `${mission.missionId}:${mission.tick}:reload:${aircraft.id}`, type: 'reload-start', targetId: aircraft.id, position: pose.position });
      }
    }
  }
  for (const owner of combat.enemyOwners) {
    const index = mission.enemies.findIndex(enemy => enemy.id === owner.ownerId);
    const enemy = mission.enemies[index];
    if (enemy.nextFireTick > mission.tick || enemy.ammunition <= 0 || enemy.reloadUntilTick !== null || combat.enemyBudget.remaining <= 0) continue;
    if (counts.magic >= state.poolCapacities.magic) { metrics.poolBlockedMagic += 1; continue; }
    const pose = world.enemies[enemy.id];
    const target = poseFor(world, owner.targetId)!;
    const targetPoint = owner.targetId.startsWith('S') ? add(target.position, { x: 0, y: world.ships[owner.targetId].height * 0.4, z: 0 }) : target.position;
    const direction = interceptDirection(pose.position, targetPoint, target.velocity, 200, 6);
    append(makeProjectile(mission.missionId, ordinal++, enemy.id, 'enemy', enemy.nextMagicType, mission.tick, pose.position, direction, 200, 0));
    mission.enemies[index] = consumeMagicRound(enemy, mission.tick);
    combat.enemyBudget.remaining -= 1; counts.magic += 1; metrics.enemyShots += 1;
  }
  for (const owner of combat.shipOwners) {
    const index = mission.ships.findIndex(ship => ship.id === owner.ownerId);
    const ship = mission.ships[index];
    if (ship.nextFireTick > mission.tick || ship.ammunition <= 0 || ship.reloadUntilTick !== null || combat.shipBudget.remaining <= 0) continue;
    if (counts.antiAir >= state.poolCapacities.antiAir) { metrics.poolBlockedAntiAir += 1; continue; }
    const pose = world.ships[ship.id];
    const target = world.enemies[owner.targetId];
    const origin = add(pose.position, { x: 0, y: pose.height * 0.6, z: 0 });
    append(makeProjectile(mission.missionId, ordinal++, ship.id, 'ship', 'anti-air', mission.tick, origin,
      interceptDirection(origin, target.position, target.velocity, 300, 3), 300, 8));
    mission.ships[index] = consumeShipRound(ship, mission.tick);
    combat.shipBudget.remaining -= 1; counts.antiAir += 1; metrics.shipShots += 1;
  }
  metrics.maxAircraftProjectiles = Math.max(metrics.maxAircraftProjectiles, counts.aircraft);
  metrics.maxMagicProjectiles = Math.max(metrics.maxMagicProjectiles, counts.magic);
  metrics.maxAntiAirProjectiles = Math.max(metrics.maxAntiAirProjectiles, counts.antiAir);
  return { mission, projectiles, combat, nextProjectileOrdinal: ordinal, metrics, events };
}

/** Collision times and burn deaths are processed before the roster commits any losses. */
export function resolveCombatTimeline(
  inputMission: MissionState, inputScore: ScoreLedger, impacts: readonly ProjectileImpact[], terrain: readonly TerrainImpact[],
): { mission: MissionState; score: ScoreLedger; events: SimulationEvent[]; maxBurns: number } {
  if (inputMission.phase !== 'playing' || inputMission.finalized) {
    return { mission: inputMission, score: inputScore, events: [], maxBurns: 0 };
  }
  const mission: MissionState = {
    ...inputMission,
    aircraft: inputMission.aircraft.map(item => ({ ...item, burns: item.burns.slice(), ice: item.ice && { ...item.ice } })),
    enemies: inputMission.enemies.map(item => ({ ...item })),
    ships: inputMission.ships.map(item => ({ ...item, burns: item.burns.slice(), ice: item.ice && { ...item.ice } })),
  };
  let score = inputScore;
  const events: SimulationEvent[] = [];
  const targets = [...mission.aircraft.filter(item => item.status === 'active'), ...mission.ships.filter(item => item.status === 'alive')];
  const burnCount = () => targets.reduce((count, target) => count + target.burns.length, 0);
  let maxBurns = burnCount();
  if (maxBurns > BURN_CAPACITY) throw new Error('Logical fire effect capacity exhausted');
  const startTime = (mission.tick - 1) / 60;
  const endTime = mission.tick / 60;
  const timeline = [
    ...impacts.filter(impact => impact.projectile.missionId === mission.missionId).map(impact => ({
      id: impact.id, time: startTime + impact.t * FIXED_DT, impact, terrain: null as TerrainImpact | null,
    })),
    ...terrain.map(impact => ({
      id: `${mission.missionId}:terrain:${String(mission.tick).padStart(9, '0')}:${impact.id}`,
      time: startTime + impact.t * FIXED_DT, impact: null as ProjectileImpact | null, terrain: impact,
    })),
  ].sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));
  let cursor = startTime;
  function advanceBurns(to: number): void {
    for (const target of targets) {
      const integrated = integrateBurns(target.hp, target.burns, cursor, to);
      target.hp = integrated.hp; target.burns = integrated.burns;
    }
    cursor = to;
  }
  for (const event of timeline) {
    if (event.time < startTime - 1e-12 || event.time > endTime + 1e-12) throw new RangeError('Collision outside the fixed tick');
    advanceBurns(event.time);
    if (event.terrain) {
      const terrainImpact = event.terrain;
      const target = terrainImpact.kind === 'aircraft' ? mission.aircraft.find(item => item.id === terrainImpact.id)
        : mission.enemies.find(item => item.id === terrainImpact.id);
      if (target && target.hp > 0) {
        target.hp = 0;
        if ('burns' in target) { target.burns = []; target.ice = null; }
        appendEvent(events, { id: event.id, type: 'terrain-impact', position: terrainImpact.point, targetId: target.id, timeSeconds: event.time });
      }
      continue;
    }
    const impact = event.impact!;
    const projectile = impact.projectile;
    if (impact.surface !== 'entity' || !impact.targetId) continue;
    if (projectile.sourceRoleAtFire === 'enemy') {
      const target = targets.find(item => item.id === impact.targetId);
      if (!target || target.hp <= 0 || (projectile.kind !== 'fire' && projectile.kind !== 'ice')) continue;
      if (projectile.kind === 'fire') {
        target.burns = addBurn(target.burns, projectile.id, target.id, event.time, burnCount());
        maxBurns = Math.max(maxBurns, burnCount());
      } else target.ice = applyIceHit(target.ice, mission.tick);
      appendEvent(events, {
        id: `${projectile.id}:impact`, type: projectile.kind === 'fire' ? 'fire-hit' : 'ice-hit',
        position: impact.position, ownerId: projectile.ownerId, targetId: target.id, kind: projectile.kind, timeSeconds: event.time,
      });
    } else {
      const target = mission.enemies.find(item => item.id === impact.targetId);
      if (!target || target.status !== 'active' || target.hp <= 0
        || (projectile.kind !== 'mg' && projectile.kind !== 'cannon' && projectile.kind !== 'anti-air')) continue;
      const damage = projectile.baseDamage * (projectile.kind === 'anti-air' ? 1 : aircraftDamageMultiplier(projectile.kind, impact.distanceTravelledM));
      const accounting = recordEnemyDamage(score, target.id, projectile.id, target.hp, damage, projectile.sourceRoleAtFire);
      score = accounting.ledger; target.hp = Math.max(0, target.hp - accounting.actualDamage);
      if (accounting.actualDamage > 0) appendEvent(events, {
        id: `${projectile.id}:impact`, type: 'hit', position: impact.position, ownerId: projectile.ownerId,
        targetId: target.id, kind: projectile.kind, damage: accounting.actualDamage, timeSeconds: event.time,
      });
    }
  }
  advanceBurns(endTime);
  return { mission, score, events, maxBurns };
}

/** The single product step follows R14; view callbacks never advance logic. */
export function stepSimulation(state: SimulationState, input: FlightInput = ZERO_INPUT, mode: GameMode = state.mode): SimulationState {
  if (state.mission.phase !== 'playing' || state.mission.finalized) return state;
  let mission = effectDeadlines(updateReloads(beginMissionTick(state.mission, createSpawnGuard(state.world))));
  const acceptedInput = mission.requiresInputRelease ? { ...ZERO_INPUT, viewAspect: input.viewAspect } : input;
  const movement = stepWorld(syncWorldState(state.world, mission), mission, acceptedInput, mode);
  mission = movement.mission;
  const emission = emitProjectiles(state, mission, movement.world, acceptedInput, mode);
  const flight = advanceProjectiles(emission.projectiles, emission.mission, movement.world);
  const resolved = resolveCombatTimeline(emission.mission, state.score, flight.impacts, movement.terrainImpacts);
  const completed = completeMissionTick(resolved.mission, { missionId: mission.missionId });
  const events = emission.events.slice();
  for (const event of resolved.events) appendEvent(events, event);
  const deadEntities = [
    ...completed.aircraft.filter(item => item.status === 'lost' && state.mission.aircraft.find(previous => previous.id === item.id)?.status !== 'lost'),
    ...completed.enemies.filter(item => item.status === 'defeated' && state.mission.enemies.find(previous => previous.id === item.id)?.status !== 'defeated'),
    ...completed.ships.filter(item => item.status === 'sunk' && state.mission.ships.find(previous => previous.id === item.id)?.status !== 'sunk'),
  ];
  for (const item of deadEntities.sort((left, right) => left.id.localeCompare(right.id))) appendEvent(events, {
    id: `${completed.missionId}:${completed.tick}:death:${item.id}`, type: 'death', targetId: item.id,
    position: poseFor(movement.world, item.id)?.position ?? ZERO_POSITION,
  });
  for (const item of [...completed.aircraft, ...completed.enemies].sort((left, right) => left.id.localeCompare(right.id))) {
    const previous = item.id.startsWith('A') ? state.mission.aircraft.find(entity => entity.id === item.id)
      : state.mission.enemies.find(entity => entity.id === item.id);
    if (item.status === 'active' && previous?.status !== 'active') appendEvent(events, {
      id: `${completed.missionId}:${completed.tick}:respawn:${item.id}`, type: 'respawn', targetId: item.id,
      position: poseFor(movement.world, item.id)?.position ?? ZERO_POSITION,
    });
  }
  if (completed.controlledAircraftId && state.mission.controlledAircraftId !== completed.controlledAircraftId) appendEvent(events, {
    id: `${completed.missionId}:${completed.tick}:handoff`, type: 'handoff', targetId: completed.controlledAircraftId,
    position: poseFor(movement.world, completed.controlledAircraftId)?.position ?? ZERO_POSITION,
  });
  const result = completed.finalized ? createResultSnapshot(completed, resolved.score, mode) : null;
  if (result) appendEvent(events, { id: `${completed.missionId}:end`, type: 'end', position: ZERO_POSITION });
  const combat = {
    ...emission.combat,
    enemyOwners: emission.combat.enemyOwners.filter(owner => {
      const enemy = completed.enemies.find(item => item.id === owner.ownerId);
      const target = completed.aircraft.find(item => item.id === owner.targetId) ?? completed.ships.find(item => item.id === owner.targetId);
      return enemy?.status === 'active' && enemy.hp > 0 && enemy.reloadUntilTick === null && target && target.hp > 0;
    }),
    shipOwners: emission.combat.shipOwners.filter(owner => {
      const ship = completed.ships.find(item => item.id === owner.ownerId);
      const target = completed.enemies.find(item => item.id === owner.targetId);
      return ship?.status === 'alive' && ship.hp > 0 && ship.reloadUntilTick === null && target?.status === 'active' && target.hp > 0;
    }),
  };
  completed.enemies = completed.enemies.map(item => ({ ...item, attackTargetId: combat.enemyOwners.find(owner => owner.ownerId === item.id)?.targetId as AircraftId | ShipId ?? null }));
  completed.ships = completed.ships.map(item => ({ ...item, ownsAttackSlot: combat.shipOwners.some(owner => owner.ownerId === item.id) }));
  if (result) {
    combat.enemyOwners = []; combat.shipOwners = [];
    completed.aircraft = completed.aircraft.map(item => ({ ...item, burns: [], ice: null }));
    completed.ships = completed.ships.map(item => ({ ...item, burns: [], ice: null, ownsAttackSlot: false }));
    completed.enemies = completed.enemies.map(item => ({ ...item, attackTargetId: null }));
  }
  assertRosterInvariants(completed);
  return {
    ...state, mission: completed, world: movement.world, mode,
    projectiles: result ? [] : flight.projectiles, combat, nextProjectileOrdinal: emission.nextProjectileOrdinal,
    score: resolved.score, result, events, boundaryWarning: movement.boundaryWarning,
    metrics: { ...emission.metrics, maxBurns: Math.max(emission.metrics.maxBurns, resolved.maxBurns), maxEvents: Math.max(emission.metrics.maxEvents, events.length) },
  };
}
