import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AIRCRAFT_WEAPONS, consumeAircraftVolley, consumeMagicRound, consumeShipRound, updateReloads,
} from '../src/ammunition.ts';
import { assignAttackSlots, createAttackBudget } from '../src/attack-budget.ts';
import { aircraftDamageMultiplier } from '../src/aircraft-damage.ts';
import {
  advanceMissionTick, assertRosterInvariants, completeMissionTick, createMissionState, type MissionState,
} from '../src/roster.ts';
import { createScoreLedger, recordEnemyDamage, scoreBreakdown } from '../src/scoring.ts';
import { advanceProjectiles, makeProjectile, projectileCounts, type ProjectileImpact } from '../src/projectiles.ts';
import {
  createSimulation, getSimulationScore, releaseSimulationInput, resetSimulation, resolveCombatTimeline,
  setSimulationPhase, stepSimulation, type SimulationState,
} from '../src/simulation.ts';
import { addBurn, applyIceHit } from '../src/status-effects.ts';
import { createWorldState, syncWorldState } from '../src/world.ts';
import { attitudeQuaternion, transformDirection, type Vec3 } from '../src/world-math.ts';

const neutral = { turn: 0, climb: 0, fire: false, loop: false };
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const mission = () => createMissionState({ missionId: 'combat', seed: 37, phase: 'playing' });

function scene(options: Parameters<typeof createSimulation>[0]['poolCapacities'] = {}): SimulationState {
  const state = releaseSimulationInput(createSimulation({ missionId: 'combat', seed: 37, phase: 'playing', poolCapacities: options }));
  const player = state.world.aircraft.A001;
  Object.assign(player, {
    position: { x: 4000, y: 1100, z: 0 }, previousPosition: { x: 4000, y: 1100, z: 0 },
    forward: { x: 0, y: 0, z: -1 }, yaw: 0, pitch: 0, bank: 0,
    quaternion: attitudeQuaternion(0, 0, 0), previousQuaternion: attitudeQuaternion(0, 0, 0),
  });
  for (const aircraft of state.mission.aircraft) if (aircraft.role === 'wing') aircraft.reloadUntilTick = 1000000;
  for (const enemy of state.mission.enemies.filter(item => item.status === 'active')) {
    const pose = state.world.enemies[enemy.id];
    const position = enemy.id === 'E001' ? { x: 4000, y: 1100, z: -50 } : { x: -4000, y: 2000, z: 4000 };
    Object.assign(pose, { position, previousPosition: { ...position }, velocity: { x: 0, y: 0, z: 10 / 3.6 } });
  }
  return state;
}

function impact(m: MissionState, ordinal: number, kind: 'mg' | 'cannon' | 'fire' | 'ice' | 'anti-air', targetId: string, t: number,
  source: 'player' | 'wing' | 'enemy' | 'ship' = kind === 'fire' || kind === 'ice' ? 'enemy' : 'player', damage = 20): ProjectileImpact {
  const projectile = makeProjectile(m.missionId, ordinal, source === 'enemy' ? 'E001' : source === 'ship' ? 'S001' : 'A001', source,
    kind, m.tick, { x: 4000, y: 1100, z: 0 }, { x: 0, y: 0, z: -1 }, 820, damage);
  return { id: projectile.id, t, projectile, position: { x: 4000, y: 1100, z: 0 }, targetId, surface: 'entity', distanceTravelledM: 100 };
}

function exhaustEnemies(m: MissionState): void {
  for (const enemy of m.enemies) {
    if (enemy.id === 'E001') continue;
    Object.assign(enemy, { status: 'defeated', hp: 0, slot: null, reservation: null, attackTargetId: null });
  }
  m.losses.enemies = 99;
}

test('A08: player and wing use both pinned weapon periods and damages, preserving clocks through role changes', () => {
  const m = mission();
  const player = m.aircraft[0];
  const mg = consumeAircraftVolley(player, 'mg', 1, 2);
  assert.equal(mg.rounds, 2); assert.equal(mg.damage, 4);
  assert.equal(mg.aircraft.machineGunAmmo, 286); assert.equal(mg.aircraft.nextMachineGunTick, 6);
  assert.equal(consumeAircraftVolley(mg.aircraft, 'mg', 5, 2).rounds, 0);
  assert.equal(consumeAircraftVolley(mg.aircraft, 'mg', 6, 2).rounds, 2);
  const cannon = consumeAircraftVolley(player, 'cannon', 1, 2);
  assert.equal(cannon.damage, 20); assert.equal(cannon.aircraft.nextCannonTick, 16);
  const wingMg = consumeAircraftVolley(m.aircraft[1], 'mg', 1, 2);
  const wingCannon = consumeAircraftVolley(m.aircraft[1], 'cannon', 1, 2);
  assert.equal(wingMg.damage, 2.4); assert.equal(wingMg.aircraft.nextMachineGunTick, 18);
  assert.equal(wingCannon.damage, 9.6); assert.equal(wingCannon.aircraft.nextCannonTick, 58);
  const handoff = { ...wingMg.aircraft, role: 'player' as const };
  assert.equal(consumeAircraftVolley(handoff, 'mg', 17, 2).rounds, 0);
  assert.deepEqual(AIRCRAFT_WEAPONS.player.mg, { period: 5, damage: 4 });
});

test('A08: entire volleys reserve pool capacity atomically; odd ammo is emitted without duplication', () => {
  const aircraft = mission().aircraft[0];
  const blocked = consumeAircraftVolley(aircraft, 'mg', 1, 1);
  assert.equal(blocked.poolBlocked, true);
  assert.strictEqual(blocked.aircraft, aircraft);
  assert.equal(aircraft.machineGunAmmo, 288); assert.equal(aircraft.nextMachineGunTick, 0);
  const retry = consumeAircraftVolley(blocked.aircraft, 'mg', 2, 2);
  assert.equal(retry.rounds, 2); assert.equal(retry.aircraft.nextMachineGunTick, 7);
  const odd = consumeAircraftVolley({ ...aircraft, machineGunAmmo: 1 }, 'mg', 1, 1);
  assert.equal(odd.rounds, 1); assert.equal(odd.aircraft.machineGunAmmo, 0);
  assert.equal(consumeAircraftVolley(odd.aircraft, 'mg', 100, 2).rounds, 0);
});

test('A08: one empty magazine does not reload; both empty start exactly six mission seconds', () => {
  let m = mission();
  m.tick = 10;
  m.aircraft[0].machineGunAmmo = 0;
  m.aircraft[0].cannonAmmo = 2;
  assert.equal(updateReloads(m).aircraft[0].reloadUntilTick, null);
  const final = consumeAircraftVolley(m.aircraft[0], 'cannon', 10, 2);
  assert.equal(final.aircraft.reloadUntilTick, 370);
  m.aircraft[0] = final.aircraft; m.tick = 369;
  assert.equal(updateReloads(m).aircraft[0].machineGunAmmo, 0);
  m.tick = 370;
  const paused = { ...m, phase: 'paused' as const };
  assert.strictEqual(updateReloads(paused), paused);
  const complete = updateReloads(m).aircraft[0];
  assert.equal(complete.machineGunAmmo, 288); assert.equal(complete.cannonAmmo, 96);
  assert.equal(complete.reloadUntilTick, null); assert.equal(complete.nextCannonTick, 25);
  m.aircraft[1] = { ...m.aircraft[1], machineGunAmmo: 0, cannonAmmo: 0 };
  const wing = updateReloads(m).aircraft[1];
  assert.equal(wing.reloadUntilTick, 730);
});

test('A05/A09: twelve alternating magic rounds and six ship rounds have independent fixed reload deadlines', () => {
  let m = mission();
  let enemy = m.enemies[0];
  const kinds: string[] = [];
  for (let index = 0; index < 12; index += 1) {
    kinds.push(enemy.nextMagicType); enemy = consumeMagicRound(enemy, 1 + index * 15);
  }
  assert.deepEqual(kinds, Array.from({ length: 12 }, (_, index) => index % 2 === 0 ? 'fire' : 'ice'));
  assert.equal(enemy.ammunition, 0); assert.equal(enemy.reloadUntilTick, 346);
  assert.equal(enemy.nextMagicType, 'fire'); assert.equal(enemy.attackTargetId, null);
  m.enemies[0] = enemy; m.tick = 345;
  assert.equal(updateReloads(m).enemies[0].ammunition, 0);
  m.tick = 346;
  assert.equal(updateReloads(m).enemies[0].ammunition, 12);
  assert.equal(updateReloads(m).enemies[0].nextFireTick, 181);
  let ship = m.ships[0];
  for (let index = 0; index < 6; index += 1) ship = consumeShipRound(ship, 1 + index * 60);
  assert.equal(ship.ammunition, 0); assert.equal(ship.reloadUntilTick, 541); assert.equal(ship.ownsAttackSlot, false);
  m.ships[0] = ship; m.tick = 541;
  assert.equal(updateReloads(m).ships[0].ammunition, 6);
});

test('A09: attack owners rotate fairly across all 24 enemies and ten ships with at most two per target', () => {
  const enemyIds = Array.from({ length: 24 }, (_, index) => `E${String(index + 1).padStart(3, '0')}`);
  const shipIds = Array.from({ length: 10 }, (_, index) => `S${String(index + 1).padStart(3, '0')}`);
  const targets = [{ id: 'A001', kind: 'aircraft' as const }, { id: 'A002', kind: 'aircraft' as const },
    { id: 'S001', kind: 'ship' as const }, { id: 'S002', kind: 'ship' as const }];
  const enemies = enemyIds.map(id => ({ id, targetIds: targets.map(target => target.id) }));
  const ships = shipIds.map(id => ({ id, targetIds: ['E001'] }));
  let budget = createAttackBudget();
  const selectedEnemies = new Set<string>(), selectedShips = new Set<string>();
  for (const tick of [1, 121, 241]) {
    budget = assignAttackSlots(budget, tick, enemies, enemyIds, targets, ships, shipIds);
    assert.equal(budget.enemyOwners.length, 8); assert.equal(budget.shipOwners.length, 4);
    for (const target of targets) assert.equal(budget.enemyOwners.filter(owner => owner.targetId === target.id).length, 2);
    for (const owner of budget.enemyOwners) selectedEnemies.add(owner.ownerId);
    for (const owner of budget.shipOwners) selectedShips.add(owner.ownerId);
  }
  assert.equal(selectedEnemies.size, 24); assert.equal(selectedShips.size, 10);
  const retained = assignAttackSlots(budget, 242, enemies.filter(enemy => enemy.id !== budget.enemyOwners[0].ownerId), enemyIds, targets, ships, shipIds);
  assert.ok(!retained.enemyOwners.some(owner => owner.ownerId === budget.enemyOwners[0].ownerId));
  assert.equal(retained.enemyOwners.length, 8);
});

test('A09/A18: replacing owners never refreshes a global budget; unused windows expire without carry', () => {
  const ids = ['E001', 'E002', 'E003'];
  const targets = [{ id: 'A001', kind: 'aircraft' as const }];
  const candidates = ids.map(id => ({ id, targetIds: ['A001'] }));
  let budget = assignAttackSlots(createAttackBudget(), 1, candidates, ids, targets, [], []);
  budget.enemyBudget.remaining = 0;
  const snapshot = structuredClone(budget);
  budget = assignAttackSlots(budget, 2, candidates.slice(1), ids, targets, [], []);
  assert.equal(budget.enemyBudget.remaining, 0);
  assert.equal(snapshot.enemyBudget.remaining, 0);
  budget.enemyBudget.remaining = 7;
  budget = assignAttackSlots(budget, 16, candidates, ids, targets, [], []);
  assert.equal(budget.enemyBudget.remaining, 8);
  assert.equal(budget.shipBudget.remaining, 4);
});

test('A08/A13: pinned aircraft attenuation uses flight distance and inclusive farther-band boundaries', () => {
  const distances = [0, 199.999, 200, 499.999, 500, 799.999, 800, 2000];
  assert.deepEqual(distances.map(distance => aircraftDamageMultiplier('mg', distance)), [1, 1, .75, .75, .5, .5, .25, .25]);
  assert.deepEqual(distances.map(distance => aircraftDamageMultiplier('cannon', distance)), [1, 1, .9, .9, .8, .8, .7, .7]);
  assert.throws(() => aircraftDamageMultiplier('mg', -1), /distance/);
});

test('A13/A14: enemy damage ledger clamps overkill, ignores duplicate/dead hits and retains player credit before allied finishing', () => {
  const m = mission();
  let ledger = createScoreLedger(m);
  let hit = recordEnemyDamage(ledger, 'E001', 'player-round', 80, 50, 'player');
  ledger = hit.ledger; assert.equal(hit.actualDamage, 50);
  hit = recordEnemyDamage(ledger, 'E001', 'player-round', 30, 50, 'player');
  assert.strictEqual(hit.ledger, ledger); assert.equal(hit.actualDamage, 0);
  hit = recordEnemyDamage(ledger, 'E001', 'wing-round', 30, 100, 'wing');
  ledger = hit.ledger; assert.equal(hit.actualDamage, 30);
  assert.equal(ledger.playerDamage, 50); assert.equal(ledger.enemies.E001.total, 80);
  assert.equal(recordEnemyDamage(ledger, 'E001', 'corpse', 0, 100, 'player').actualDamage, 0);
  assert.equal(scoreBreakdown(ledger, { player: 0, wing: 0, ships: 0, enemies: 1 }, 600, true).total, 350);
});

test('A14: one time bonus, zero on defeat/zero contribution/600 seconds, and finite score endpoints', () => {
  const m = mission();
  let ledger = createScoreLedger(m);
  const noLosses = { player: 0, wing: 0, ships: 0, enemies: 100 };
  assert.equal(scoreBreakdown(ledger, noLosses, 0, true).timeBonus, 0);
  for (const enemy of m.enemies) ledger = recordEnemyDamage(ledger, enemy.id, enemy.id, 80, 999, 'player').ledger;
  assert.equal(ledger.playerDamage, 8000);
  assert.equal(scoreBreakdown(ledger, noLosses, 0, true).total, 60000);
  assert.equal(scoreBreakdown(ledger, noLosses, 600, true).timeBonus, 0);
  assert.equal(scoreBreakdown(ledger, noLosses, 601, true).timeBonus, 0);
  assert.equal(scoreBreakdown(ledger, noLosses, 0, false).timeBonus, 0);
  assert.equal(scoreBreakdown(createScoreLedger(m), { player: 50, wing: 0, ships: 10, enemies: 0 }, 1000).total, -35000);
  const partial = { ...ledger, playerDamage: 0.15 };
  near(scoreBreakdown(partial, { ...noLosses, enemies: 0 }, 600).rawTotal, 0.75);
  assert.equal(scoreBreakdown(partial, { ...noLosses, enemies: 0 }, 600).total, 1);
  assert.ok(scoreBreakdown(ledger, noLosses, 100, true).timeBonus > scoreBreakdown(ledger, noLosses, 200, true).timeBonus);
});

test('A13: fractional distance-reduced damage reaches exact death without a ledger-created HP residue', () => {
  for (const damage of [6.72, 2.16, 1.2]) {
    let ledger = createScoreLedger(mission());
    let hp = 80;
    let hits = 0;
    while (hp > 0 && hits < 1000) {
      const event = recordEnemyDamage(ledger, 'E001', `fractional-${hits++}`, hp, damage, 'player');
      ledger = event.ledger; hp = Math.max(0, hp - event.actualDamage);
    }
    assert.equal(hp, 0); assert.ok(hits <= Math.ceil(80 / damage));
    assert.ok(ledger.enemies.E001.total <= 80); assert.ok(ledger.playerDamage <= 80);
  }
});

test('A10/A11: timeline integrates only the fire-hit tick remainder and applies ice starting next tick', () => {
  let m = mission(); m.tick = 1;
  let ledger = createScoreLedger(m);
  const fire = impact(m, 1, 'fire', 'A001', 0.75);
  const ice = impact(m, 2, 'ice', 'A001', 1);
  const step = resolveCombatTimeline(m, ledger, [ice, fire], []);
  near(step.mission.aircraft[0].hp, 80 - 8 / 60 * .25);
  assert.deepEqual(step.mission.aircraft[0].ice, { startsAtTick: 2, expiresAtTick: 302 });
  near(step.mission.aircraft[0].burns[0].startsAtSeconds, 0.75 / 60);
  m = completeMissionTick(step.mission, { missionId: m.missionId });
  for (let tick = 2; tick <= 62; tick += 1) {
    m = { ...m, tick };
    const next = resolveCombatTimeline(m, ledger, [], []);
    m = next.mission; ledger = next.score;
  }
  near(m.aircraft[0].hp, 72);
  assert.equal(m.aircraft[0].burns.length, 0);
});

test('A10/A18: 256 in-flight fireballs plus 40 recent hits all retain logical effects on concentrated arrival', () => {
  const m = mission(); m.tick = 1;
  const hits = Array.from({ length: 296 }, (_, index) => impact(m, index + 1, 'fire', 'S001', 1));
  const result = resolveCombatTimeline(m, createScoreLedger(m), hits, []);
  assert.equal(result.maxBurns, 296);
  assert.equal(result.mission.ships[0].burns.length, 296);
  assert.equal(result.mission.ships[0].hp, 1200);
  const after = resolveCombatTimeline({ ...result.mission, tick: 2 }, result.score, [], []);
  near(after.mission.ships[0].hp, 1200 - 296 * 8 / 60);
});

test('A10/A13: chronological events precede ID order; owner death retains fire and target death blocks following hits', () => {
  const m = mission(); m.tick = 1; m.enemies[0].hp = 10;
  const ledger = createScoreLedger(m);
  const latePlayer = impact(m, 1, 'cannon', 'E001', .9, 'player', 20);
  const earlierShip = impact(m, 2, 'anti-air', 'E001', .1, 'ship', 8);
  const fire = impact(m, 3, 'fire', 'A001', .05);
  const resolved = resolveCombatTimeline(m, ledger, [latePlayer, earlierShip, fire], []);
  assert.equal(resolved.mission.enemies[0].hp, 0);
  assert.equal(resolved.score.playerDamage, 2);
  near(resolved.mission.aircraft[0].hp, 80 - 8 / 60 * .95);
  assert.equal(resolved.mission.aircraft[0].burns.length, 1);
  const sameTime = resolveCombatTimeline(m, ledger, [impact(m, 2, 'cannon', 'E001', .5, 'wing', 20), impact(m, 1, 'cannon', 'E001', .5, 'player', 20)], []);
  assert.equal(sameTime.score.playerDamage, 10);
});

test('A12/A13: terrain loss occurs at its swept time and never enters player damage accounting', () => {
  const m = mission(); m.tick = 1;
  const resolved = resolveCombatTimeline(m, createScoreLedger(m), [impact(m, 1, 'cannon', 'E001', .8, 'player', 20)], [
    { id: 'E001', kind: 'enemy', t: .2, point: { x: 0, y: 800, z: 0 }, surface: 'island' },
  ]);
  assert.equal(resolved.score.playerDamage, 0);
  const completed = completeMissionTick(resolved.mission, { missionId: m.missionId });
  assert.equal(completed.losses.enemies, 1);
  assert.equal(scoreBreakdown(resolved.score, completed.losses, 1 / 60).total, 100);
});

test('A08/A18: forced pool failure retries next tick with no ammo, clock or projectile-ID consumption', () => {
  let state = scene({ aircraft: 1 });
  const original = structuredClone(state);
  state = stepSimulation(state, { ...neutral, fire: true });
  assert.deepEqual(original.mission.aircraft[0], scene({ aircraft: 1 }).mission.aircraft[0]);
  assert.equal(state.mission.aircraft[0].machineGunAmmo, 288); assert.equal(state.mission.aircraft[0].cannonAmmo, 96);
  assert.equal(state.mission.aircraft[0].nextMachineGunTick, 0); assert.equal(state.mission.aircraft[0].nextCannonTick, 0);
  assert.equal(state.nextProjectileOrdinal, original.nextProjectileOrdinal + state.metrics.enemyShots + state.metrics.shipShots);
  assert.equal(state.metrics.poolBlockedAircraft, 2);
  state = { ...state, poolCapacities: { ...state.poolCapacities, aircraft: 4 } };
  state = stepSimulation(state, { ...neutral, fire: true });
  assert.equal(state.mission.aircraft[0].machineGunAmmo, 286); assert.equal(state.mission.aircraft[0].cannonAmmo, 94);
  assert.equal(state.metrics.aircraftShots, 4);
});

test('A12/A18: frozen prior simulation remains untouched across a tick and a spent budget window', () => {
  function freeze(value: unknown): void {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  }
  let state = scene();
  state = stepSimulation(state, neutral);
  const before = structuredClone(state);
  freeze(state);
  const next = stepSimulation(state, { ...neutral, fire: true });
  assert.deepEqual(state, before);
  assert.equal(next.mission.tick, state.mission.tick + 1);
});

test('A04/A10/A11/A17: pause excludes time, reloads and effects; restart invalidates all old mission data', () => {
  let state = scene();
  state.mission.aircraft[0].burns = addBurn([], 'old-fire', 'A001', 0, 0);
  state.mission.aircraft[0].ice = applyIceHit(null, 0);
  state.mission.aircraft[0].machineGunAmmo = 0; state.mission.aircraft[0].cannonAmmo = 0;
  state = stepSimulation(state, neutral);
  const paused = setSimulationPhase(state, 'paused');
  for (let index = 0; index < 600; index += 1) assert.strictEqual(stepSimulation(paused, neutral), paused);
  assert.equal(paused.mission.tick, 1);
  const delayed = resolveCombatTimeline(paused.mission, paused.score, [impact(paused.mission, 999, 'fire', 'A001', .5)], []);
  assert.strictEqual(delayed.mission, paused.mission); assert.strictEqual(delayed.score, paused.score);
  assert.strictEqual(releaseSimulationInput(paused, 'stale', paused.mission.controlResetVersion), paused);
  const restart = resetSimulation(paused, { missionId: 'new-combat', phase: 'playing' });
  assert.equal(restart.mission.tick, 0); assert.equal(restart.mission.aircraft[0].hp, 80);
  assert.equal(restart.mission.aircraft[0].machineGunAmmo, 288); assert.deepEqual(restart.mission.aircraft[0].burns, []);
  assert.equal(restart.mission.aircraft[0].ice, null); assert.deepEqual(restart.projectiles, []);
  assert.throws(() => resetSimulation(paused, { missionId: paused.mission.missionId }), /fresh/);
});

test('A02/A17: respawn/handoff tick rejects held fire, loop and throttle, including Easy automatic fire', () => {
  for (const mode of ['normal', 'easy'] as const) {
    let state = scene();
    state = { ...state, mode, mission: advanceMissionTick(state.mission, { missionId: state.mission.missionId, aircraftIds: ['A001'] }) };
    state.mission.tick = 180;
    const result = stepSimulation(state, { ...neutral, fire: true, loop: true, accelerate: true }, mode);
    assert.equal(result.mission.controlledAircraftId, 'A009');
    assert.equal(result.mission.requiresInputRelease, true);
    assert.equal(result.mission.aircraft[8].machineGunAmmo, 288);
    assert.equal(result.mission.aircraft[8].cannonAmmo, 96);
    assert.equal(result.mission.aircraft[8].loopActive, false);
    near(result.mission.aircraft[8].baseSpeedMps, 110);
  }
});

test('A13: old player rounds still contribute after owner death; old wing rounds retain wing attribution after control transfer', () => {
  let state = scene();
  state.mission = advanceMissionTick(state.mission, { missionId: state.mission.missionId, aircraftIds: ['A001'] });
  const enemy = state.world.enemies.E001.position;
  state.projectiles = [makeProjectile('combat', 100, 'A001', 'player', 'mg', 0, { ...enemy, z: enemy.z + 5 }, { x: 0, y: 0, z: -1 }, 820, 4)];
  state.nextProjectileOrdinal = 101;
  state = stepSimulation(state, neutral);
  assert.equal(state.mission.aircraft[0].status, 'lost'); near(state.score.playerDamage, 4);
  let wing = scene();
  for (const aircraft of wing.mission.aircraft) {
    if (aircraft.id === 'A002') continue;
    Object.assign(aircraft, { status: 'lost', hp: 0, slot: null, reservation: null, role: aircraft.id === 'A001' ? 'player' : 'wing' });
  }
  Object.assign(wing.mission.aircraft[1], { role: 'player', slot: 0, reloadUntilTick: null });
  wing.mission.losses.player = 1; wing.mission.losses.wing = 48; wing.mission.controlledAircraftId = 'A002';
  wing.mission.controlResetVersion += 1; wing.world = syncWorldState(wing.world, wing.mission);
  const target = wing.world.enemies.E001.position;
  wing.projectiles = [makeProjectile('combat', 100, 'A002', 'wing', 'mg', 0, { ...target, z: target.z + 5 }, { x: 0, y: 0, z: -1 }, 820, 2.4)];
  wing.nextProjectileOrdinal = 101;
  wing = stepSimulation(wing, neutral);
  near(wing.score.playerDamage, 0); near(wing.score.enemies.E001.total, 2.4);
});

for (const lastSide of ['fleet', 'aircraft', 'victory'] as const) {
  test(`A12: same-tick final enemy/${lastSide} deaths produce one immutable result with defeat priority`, () => {
    let state = scene();
    exhaustEnemies(state.mission);
    state.mission.enemies[0].hp = 20;
    if (lastSide === 'fleet') {
      for (const ship of state.mission.ships) if (ship.id !== 'S001') Object.assign(ship, { status: 'sunk', hp: 0, ownsAttackSlot: false });
      state.mission.losses.ships = 9;
      state.mission.ships[0].hp = .05;
      state.mission.ships[0].burns = addBurn([], 'fatal-fire', 'S001', 0, 0);
    } else if (lastSide === 'aircraft') {
      for (const aircraft of state.mission.aircraft) if (aircraft.id !== 'A001') {
        Object.assign(aircraft, { status: 'lost', hp: 0, slot: null, reservation: null, role: 'wing' });
      }
      state.mission.losses.wing = 49;
      state.mission.aircraft[0].hp = .05;
      state.mission.aircraft[0].burns = addBurn([], 'fatal-fire', 'A001', 0, 0);
    }
    state.world = syncWorldState(state.world, state.mission);
    const target = state.world.enemies.E001.position;
    state.projectiles = [makeProjectile('combat', 100, 'A001', 'player', 'cannon', 0, { ...target, z: target.z + 5 }, { x: 0, y: 0, z: -1 }, 820, 20)];
    state.nextProjectileOrdinal = 101;
    state = stepSimulation(state, neutral);
    assert.equal(state.mission.losses.enemies, 100);
    assert.equal(state.result!.outcome, lastSide === 'victory' ? 'victory' : 'defeat');
    assert.equal(state.result!.reason, lastSide === 'victory' ? 'all-enemies-defeated' : 'mutual-destruction');
    assert.equal(state.events.filter(event => event.type === 'end').length, 1);
    assert.equal(state.result!.elapsedSeconds, 1 / 60);
    assert.equal(Object.isFrozen(state.result), true); assert.equal(Object.isFrozen(state.result!.losses), true);
    assert.equal(Object.isFrozen(state.result!.breakdown), true);
    assert.equal(state.projectiles.length, 0); assert.equal(state.combat.enemyOwners.length, 0);
    assert.strictEqual(stepSimulation(state, { ...neutral, fire: true }), state);
    assert.strictEqual(releaseSimulationInput(state), state);
    assert.equal(getSimulationScore(state).total, state.result!.score);
    if (lastSide !== 'victory') assert.equal(state.result!.breakdown.timeBonus, 0);
    assertRosterInvariants(state.mission);
  });
}

test('A06/A13: projectile sweep chooses the first entity/rock only and preserves cumulative actual path', () => {
  const m = mission(); const world = createWorldState(m);
  for (const enemy of Object.values(world.enemies)) Object.assign(enemy, { position: { x: -5000, y: 2000, z: 0 }, previousPosition: { x: -5000, y: 2000, z: 0 } });
  Object.assign(world.enemies.E001, { position: { x: 4000, y: 1100, z: 0 }, previousPosition: { x: 4000, y: 1100, z: 0 } });
  Object.assign(world.enemies.E002, { position: { x: 4000, y: 1100, z: -3 }, previousPosition: { x: 4000, y: 1100, z: -3 } });
  const projectile = makeProjectile('combat', 1, 'A001', 'player', 'mg', 0, { x: 4000, y: 1100, z: 5 }, { x: 0, y: 0, z: -1 }, 820, 4);
  projectile.distanceTravelledM = 199;
  const result = advanceProjectiles([projectile], m, world);
  assert.equal(result.projectiles.length, 0); assert.equal(result.impacts.length, 1);
  assert.equal(result.impacts[0].targetId, 'E001'); near(result.impacts[0].distanceTravelledM, 201.5);
  assert.equal(aircraftDamageMultiplier('mg', result.impacts[0].distanceTravelledM), .75);
  const islandRound = makeProjectile('combat', 2, 'A001', 'player', 'mg', 0, { x: 0, y: 1000, z: 0 }, { x: 0, y: -1, z: 0 }, 20000, 4);
  const rock = advanceProjectiles([islandRound], m, world);
  assert.equal(rock.impacts[0].surface, 'island'); assert.equal(rock.impacts[0].targetId, null);
});

test('A05/A09: real world enemy eligibility reaches player, wing and deck-level ship targets', () => {
  let state = scene();
  const ship = state.world.ships.S001;
  for (const enemy of state.mission.enemies.filter(item => item.status === 'active')) {
    const pose = state.world.enemies[enemy.id];
    const position = { x: ship.position.x + 100, y: 100, z: ship.position.z };
    Object.assign(pose, { position, previousPosition: { ...position }, velocity: { x: 0, y: 0, z: 10 } });
  }
  for (const id of ['A001', 'A002']) {
    const pose = state.world.aircraft[id];
    const position = { x: ship.position.x + 150, y: 100, z: ship.position.z + (id === 'A001' ? 0 : 50) };
    Object.assign(pose, { position, previousPosition: { ...position } });
  }
  state = stepSimulation(state, neutral);
  const targetIds = state.combat.enemyOwners.map(owner => owner.targetId);
  assert.ok(targetIds.includes('A001')); assert.ok(targetIds.includes('A002')); assert.ok(targetIds.some(id => id.startsWith('S')));
  assert.ok(state.projectiles.some(projectile => projectile.sourceRoleAtFire === 'ship'));
  assert.ok(state.projectiles.some(projectile => projectile.sourceRoleAtFire === 'enemy'));
  assert.ok(state.combat.shipOwners.length <= 4); assert.ok(state.combat.enemyOwners.length <= 8);
  assert.ok(state.mission.ships[0].ammunition < 6);
});

test('A18: 30/60/120 render batching leaves the same authoritative simulation after accepted fixed inputs', () => {
  function run(batch: number) {
    let state = scene();
    for (let frame = 0; frame < 120 / batch; frame += 1) {
      for (let offset = 0; offset < batch; offset += 1) {
        const tick = frame * batch + offset;
        state = stepSimulation(state, { ...neutral, turn: tick > 50 ? .1 : 0, fire: tick < 50 });
      }
    }
    return state;
  }
  assert.deepEqual(run(2), run(1));
  assert.deepEqual(run(4), run(1));
});

test('A12/A18: reversed entity/projectile storage order produces identical next-state logic and events', () => {
  let forward = scene();
  const enemy = forward.world.enemies.E001.position;
  forward.projectiles = [
    makeProjectile('combat', 100, 'A001', 'player', 'mg', 0, { ...enemy, z: enemy.z + 5 }, { x: 0, y: 0, z: -1 }, 820, 4),
    makeProjectile('combat', 101, 'A002', 'wing', 'mg', 0, { x: 5000, y: 1900, z: 0 }, { x: 0, y: 0, z: -1 }, 820, 2.4),
    makeProjectile('combat', 102, 'A001', 'player', 'cannon', 0, { x: 5000, y: 1900, z: 10 }, { x: 0, y: 0, z: -1 }, 700, 20),
  ];
  forward.nextProjectileOrdinal = 103;
  forward = stepSimulation(forward, neutral);
  const reverse = structuredClone(forward);
  reverse.mission.aircraft.reverse(); reverse.mission.enemies.reverse(); reverse.mission.ships.reverse();
  reverse.projectiles.reverse(); reverse.combat.enemyOwners.reverse(); reverse.combat.shipOwners.reverse();
  for (const key of ['aircraft', 'enemies', 'ships'] as const) {
    Object.assign(reverse.world, { [key]: Object.fromEntries(Object.entries(reverse.world[key]).reverse()) });
  }
  assert.deepEqual(stepSimulation(reverse, { ...neutral, fire: true }), stepSimulation(forward, { ...neutral, fire: true }));
});
