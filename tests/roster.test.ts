import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AIRCRAFT_RESPAWN_TICKS, ENEMY_RESPAWN_TICKS, acknowledgeInputRelease,
  advanceMissionTick, assertRosterInvariants, beginMissionTick, completeMissionTick,
  createMissionState, getRosterCounts, getRosterOutcome, resetMission, setMissionPhase,
  type AircraftId, type MissionState,
} from '../src/roster.ts';

function mission(): MissionState {
  return createMissionState({ missionId: 'mission-1', seed: 37, phase: 'playing' });
}

function ticks(state: MissionState, count: number): MissionState {
  for (let index = 0; index < count; index += 1) state = advanceMissionTick(state);
  return state;
}

function kill(state: MissionState, aircraftIds: AircraftId[]): MissionState {
  return advanceMissionTick(state, { missionId: state.missionId, aircraftIds });
}

/** Spend all 42 reserves through actual wing losses, leaving the last seven pending. */
function reserveExhaustedWithPending(): MissionState {
  let state = mission();
  for (let wave = 0; wave < 6; wave += 1) {
    state = kill(state, state.aircraft.filter(item => item.status === 'active' && item.role === 'wing').map(item => item.id));
    if (wave < 5) state = ticks(state, AIRCRAFT_RESPAWN_TICKS);
  }
  assert.deepEqual(getRosterCounts(state).aircraft, { reserve: 0, pending: 7, active: 1, lost: 42, remaining: 8 });
  return state;
}

function reserveExhaustedWithSurvivors(): MissionState {
  return ticks(reserveExhaustedWithPending(), AIRCRAFT_RESPAWN_TICKS);
}

function earlierWingLaterPlayer(): MissionState {
  let state = mission();
  for (let wave = 0; wave < 5; wave += 1) {
    state = kill(state, state.aircraft.filter(item => item.status === 'active' && item.role === 'wing').map(item => item.id));
    state = ticks(state, AIRCRAFT_RESPAWN_TICKS);
  }
  state = kill(state, ['A037']); // A044 wing reservation.
  state = ticks(state, 9);
  state = kill(state, ['A001']); // A045 player reservation, ten ticks later.
  return state;
}

function onlyLastEnemies(): MissionState {
  let state = mission();
  for (let wave = 0; wave < 4; wave += 1) {
    state = advanceMissionTick(state, {
      missionId: state.missionId,
      enemyIds: state.enemies.filter(item => item.status === 'active').map(item => item.id),
    });
    state = ticks(state, ENEMY_RESPAWN_TICKS);
  }
  assert.deepEqual(getRosterCounts(state).enemies, { reserve: 0, pending: 0, active: 4, defeated: 96, remaining: 4 });
  return state;
}

test('A01: fixed identities, initial rosters and ten finite ships', () => {
  const state = mission();
  assert.deepEqual(getRosterCounts(state), {
    aircraft: { reserve: 42, pending: 0, active: 8, lost: 0, remaining: 50 },
    enemies: { reserve: 76, pending: 0, active: 24, defeated: 0, remaining: 100 },
    ships: { alive: 10, sunk: 0 },
  });
  assert.equal(state.aircraft[0].id, 'A001');
  assert.equal(state.aircraft.at(-1)!.id, 'A050');
  assert.equal(state.enemies.at(-1)!.id, 'E100');
  assert.equal(state.ships.at(-1)!.id, 'S010');
  assert.equal(state.controlledAircraftId, 'A001');
  assert.ok(state.aircraft.filter(item => item.status === 'active').every(item => item.hp === 80));
  assert.ok(state.ships.every(item => item.hp === 1200));
  assertRosterInvariants(state);
});

test('A01/A03: simultaneous deaths reserve player first, consume each ID once and preserve inputs', () => {
  const original = mission();
  const snapshot = structuredClone(original);
  const state = advanceMissionTick(original, {
    missionId: original.missionId,
    aircraftIds: ['A008', 'A001', 'A002', 'A001', 'A008'],
    enemyIds: ['E024', 'E001', 'E001'], shipIds: ['S002', 'S002'],
  });
  assert.deepEqual(original, snapshot);
  assert.deepEqual(state.losses, { player: 1, wing: 2, enemies: 2, ships: 1 });
  assert.equal(state.controlledAircraftId, null);
  assert.deepEqual(state.aircraft.find(item => item.id === 'A009')!.reservation, {
    missionId: 'mission-1', entityId: 'A009', slot: 0, dueTick: 181,
  });
  assert.equal(state.aircraft.find(item => item.id === 'A010')!.slot, 1);
  assert.equal(state.aircraft.find(item => item.id === 'A011')!.slot, 7);
  assert.equal(state.enemies.find(item => item.id === 'E025')!.reservation!.dueTick, 121);
  assert.equal(getRosterCounts(state).aircraft.remaining, 47);
  const repeated = completeMissionTick(state, {
    missionId: state.missionId, aircraftIds: ['A001', 'A002', 'A008'], enemyIds: ['E001', 'E024'], shipIds: ['S002'],
  });
  assert.deepEqual(repeated, state);
  assertRosterInvariants(repeated);
});

test('A01/A02: reserve respawn uses exactly 180 mission ticks and newly spawns full state', () => {
  let state = mission();
  state.aircraft[8].machineGunAmmo = 0;
  state.aircraft[8].cannonAmmo = 0;
  state.aircraft[8].reloadUntilTick = 9999;
  state.aircraft[8].burns.push({ projectileId: 'old', startsAtSeconds: 0, endsAtSeconds: 1 });
  state.aircraft[8].ice = { startsAtTick: 1, expiresAtTick: 500 };
  state = kill(state, ['A001']);
  const dueTick = state.aircraft[8].reservation!.dueTick;
  state = ticks(state, AIRCRAFT_RESPAWN_TICKS - 1);
  assert.equal(state.tick, dueTick - 1);
  assert.equal(state.controlledAircraftId, null);
  assert.equal(state.aircraft[8].status, 'pending');
  state = advanceMissionTick(state);
  assert.equal(state.tick, dueTick);
  assert.equal(state.controlledAircraftId, 'A009');
  assert.equal(state.aircraft[8].hp, 80);
  assert.equal(state.aircraft[8].machineGunAmmo, 288);
  assert.equal(state.aircraft[8].cannonAmmo, 96);
  assert.equal(state.aircraft[8].reloadUntilTick, null);
  assert.deepEqual(state.aircraft[8].burns, []);
  assert.equal(state.aircraft[8].ice, null);
  assert.equal(state.aircraft[0].status, 'lost');
  assert.equal(getRosterCounts(state).aircraft.remaining, 49);
});

test('A01/A04: enemy active=0 still reserves all finite reinforcements, exactly 120 ticks later', () => {
  let state = mission();
  state = advanceMissionTick(state, {
    missionId: state.missionId,
    enemyIds: state.enemies.filter(item => item.status === 'active').map(item => item.id),
  });
  assert.deepEqual(getRosterCounts(state).enemies, { reserve: 52, pending: 24, active: 0, defeated: 24, remaining: 76 });
  assert.equal(state.phase, 'playing');
  assert.equal(getRosterOutcome(state), null);
  state = ticks(state, ENEMY_RESPAWN_TICKS - 1);
  assert.equal(getRosterCounts(state).enemies.active, 0);
  state = advanceMissionTick(state);
  assert.equal(getRosterCounts(state).enemies.active, 24);
  assert.ok(state.enemies.slice(0, 24).every(item => item.status === 'defeated'));
  assert.ok(state.enemies.slice(24, 48).every(item => item.status === 'active' && item.hp === 80 && item.ammunition === 12));
});

test('A01: pause/Home do not advance deadlines, paused input/death events cannot mutate rosters', () => {
  let state = kill(mission(), ['A001']);
  const dueTick = state.aircraft[8].reservation!.dueTick;
  state = setMissionPhase(state, 'paused');
  const paused = state;
  state = ticks(state, 600);
  assert.strictEqual(state, paused);
  assert.strictEqual(completeMissionTick(state, { missionId: state.missionId, aircraftIds: ['A002'] }), paused);
  assert.equal(state.aircraft[8].reservation!.dueTick, dueTick);
  state = setMissionPhase(state, 'playing');
  state = ticks(state, AIRCRAFT_RESPAWN_TICKS);
  assert.equal(state.controlledAircraftId, 'A009');
  state = setMissionPhase(state, 'home');
  assert.strictEqual(ticks(state, 600), state);
  assert.throws(() => setMissionPhase(state, 'playing'), /fresh mission/);
});

test('A02: reserve=0 moves smallest pending ID atomically to player slot with original deadline', () => {
  let state = reserveExhaustedWithPending();
  const pending = state.aircraft.find(item => item.id === 'A044')!;
  const originalDue = pending.reservation!.dueTick;
  const originalMission = pending.reservation!.missionId;
  state = ticks(state, 30);
  state = kill(state, ['A001']);
  const reassigned = state.aircraft.find(item => item.id === 'A044')!;
  assert.equal(reassigned.status, 'pending');
  assert.equal(reassigned.slot, 0);
  assert.equal(reassigned.role, 'player');
  assert.equal(reassigned.reservation!.slot, 0);
  assert.equal(reassigned.reservation!.dueTick, originalDue);
  assert.equal(reassigned.reservation!.missionId, originalMission);
  assert.deepEqual(getRosterCounts(state).aircraft, { reserve: 0, pending: 7, active: 0, lost: 43, remaining: 7 });
  assert.equal(state.phase, 'playing');
  assert.equal(state.handoff, null);
  state = ticks(state, originalDue - state.tick - 1);
  assert.equal(state.controlledAircraftId, null);
  state = advanceMissionTick(state);
  assert.equal(state.controlledAircraftId, 'A044');
  assert.equal(getRosterCounts(state).aircraft.active, 7);
  assert.equal(getRosterCounts(state).aircraft.remaining, 7);
});

for (const exhaustReserve of [false, true]) {
  test(`A02: earlier due wing swaps later player reservation, reserve ${exhaustReserve ? '=0' : '>0'}`, () => {
    let state = earlierWingLaterPlayer();
    if (exhaustReserve) {
      state = ticks(state, 9);
      state = kill(state, ['A038', 'A039', 'A040', 'A041', 'A042']);
    }
    assert.equal(getRosterCounts(state).aircraft.reserve, exhaustReserve ? 0 : 5);
    const wing = state.aircraft.find(item => item.id === 'A044')!;
    const player = state.aircraft.find(item => item.id === 'A045')!;
    const wingDue = wing.reservation!.dueTick;
    const playerDue = player.reservation!.dueTick;
    const originalWingSlot = wing.slot;
    const originalRemaining = getRosterCounts(state).aircraft.remaining;
    assert.equal(playerDue - wingDue, 10);
    assert.equal(player.slot, 0);
    state = ticks(state, wingDue - state.tick - 1);
    assert.equal(state.controlledAircraftId, null);
    state = advanceMissionTick(state);
    assert.equal(state.tick, wingDue);
    assert.equal(state.controlledAircraftId, 'A044');
    assert.equal(state.aircraft.find(item => item.id === 'A044')!.slot, 0);
    const movedPlayer = state.aircraft.find(item => item.id === 'A045')!;
    assert.equal(movedPlayer.status, 'pending');
    assert.equal(movedPlayer.role, 'wing');
    assert.equal(movedPlayer.slot, originalWingSlot);
    assert.equal(movedPlayer.reservation!.slot, originalWingSlot);
    assert.equal(movedPlayer.reservation!.dueTick, playerDue);
    assert.equal(movedPlayer.reservation!.missionId, state.missionId);
    assert.equal(getRosterCounts(state).aircraft.remaining, originalRemaining);
    assertRosterInvariants(state);
    state = ticks(state, playerDue - state.tick);
    assert.equal(state.controlledAircraftId, 'A044');
    assert.equal(state.aircraft.find(item => item.id === 'A045')!.status, 'active');
    assert.equal(state.aircraft.find(item => item.id === 'A045')!.role, 'wing');
    assert.equal(getRosterCounts(state).aircraft.remaining, originalRemaining);
  });
}

test('A02/A03: living-wing control transfers next tick, retains combat state, resets loop and input', () => {
  let state = reserveExhaustedWithSurvivors();
  const candidate = state.aircraft.find(item => item.id === 'A044')!;
  Object.assign(candidate, {
    hp: 17.5, machineGunAmmo: 13, cannonAmmo: 4,
    reloadUntilTick: state.tick + 123, nextMachineGunTick: state.tick + 7, nextCannonTick: state.tick + 21,
    baseSpeedMps: 97, actualSpeedMps: 83, loopActive: true, loopProgress: 0.61,
    loopCooldownUntilTick: state.tick + 222,
    burns: [{ projectileId: 'retained-burn', startsAtSeconds: state.tick / 60, endsAtSeconds: state.tick / 60 + 1 }],
    ice: { startsAtTick: state.tick - 1, expiresAtTick: state.tick + 99 },
  });
  const before = structuredClone(candidate);
  state = acknowledgeInputRelease(state, state.missionId, state.controlResetVersion);
  const oldResetVersion = state.controlResetVersion;
  state = kill(state, ['A001']);
  assert.equal(state.controlledAircraftId, null);
  assert.equal(state.aircraft.find(item => item.id === 'A044')!.role, 'wing');
  assert.deepEqual(state.handoff, { aircraftId: 'A044', missionId: state.missionId, atTick: state.tick + 1 });
  assert.equal(state.requiresInputRelease, true);
  state = beginMissionTick(state);
  assert.equal(state.controlledAircraftId, 'A044');
  const after = state.aircraft.find(item => item.id === 'A044')!;
  const expected = { ...before, slot: 0, role: 'player', loopActive: false, loopProgress: 0 };
  assert.deepEqual(after, expected);
  assert.ok(state.controlResetVersion > oldResetVersion);
  assert.equal(getRosterCounts(state).aircraft.remaining, 7);
  assert.equal(state.losses.player, 1);
  assert.equal(state.losses.wing, 42);
  assert.strictEqual(acknowledgeInputRelease(state, state.missionId, oldResetVersion), state);
  assert.strictEqual(acknowledgeInputRelease(state, 'old-mission', state.controlResetVersion), state);
  state = acknowledgeInputRelease(state, state.missionId, state.controlResetVersion);
  assert.equal(state.requiresInputRelease, false);
});

test('A02: candidate death before next tick is a wing loss, reevaluates minimum living ID', () => {
  let state = kill(reserveExhaustedWithSurvivors(), ['A001']);
  assert.equal(state.handoff!.aircraftId, 'A044');
  // Combat reports zero HP before the next boundary; ownership has not transferred.
  state.aircraft.find(item => item.id === 'A044')!.hp = 0;
  state = beginMissionTick(state);
  assert.equal(state.aircraft.find(item => item.id === 'A044')!.status, 'lost');
  assert.equal(state.losses.player, 1);
  assert.equal(state.losses.wing, 43);
  assert.equal(state.controlledAircraftId, 'A045');
  assert.equal(state.handoff, null);
  assertRosterInvariants(state);
});

test('A02: simultaneous player and smallest-wing deaths pick only a surviving candidate', () => {
  let state = kill(reserveExhaustedWithSurvivors(), ['A044', 'A001', 'A045']);
  assert.equal(state.handoff!.aircraftId, 'A046');
  assert.equal(state.losses.player, 1);
  assert.equal(state.losses.wing, 44);
  state = advanceMissionTick(state);
  assert.equal(state.controlledAircraftId, 'A046');
});

test('A01/A02/A03: exhaust all 50 identities, finite positive wait, no lost ID can return', () => {
  let state = mission();
  const lostIds = new Set<AircraftId>();
  let longestWait = 0;
  let waiting = 0;
  for (let index = 0; index < 10000 && !state.finalized; index += 1) {
    const player = state.controlledAircraftId;
    state = advanceMissionTick(state, { missionId: state.missionId, aircraftIds: player ? [player, player] : [] });
    for (const aircraft of state.aircraft) {
      if (lostIds.has(aircraft.id)) assert.equal(aircraft.status, 'lost');
      if (aircraft.status === 'lost') lostIds.add(aircraft.id);
    }
    const counts = getRosterCounts(state);
    assert.equal(counts.aircraft.reserve + counts.aircraft.pending + counts.aircraft.active + counts.aircraft.lost, 50);
    assert.ok(counts.aircraft.active + counts.aircraft.pending <= 8);
    if (counts.aircraft.remaining > 0 && !state.controlledAircraftId) {
      waiting += 1; longestWait = Math.max(longestWait, waiting);
      assert.ok(waiting <= AIRCRAFT_RESPAWN_TICKS, 'positive roster never waits indefinitely');
    } else waiting = 0;
  }
  assert.equal(state.outcome, 'defeat');
  assert.equal(getRosterCounts(state).aircraft.remaining, 0);
  assert.equal(lostIds.size, 50);
  assert.equal(state.losses.player, 50);
  assert.equal(state.losses.wing, 0);
  assert.ok(longestWait <= AIRCRAFT_RESPAWN_TICKS);
  assert.equal(state.aircraft.filter(item => item.status === 'pending').length, 0);
});

test('A04: only all 100 finite enemies defeated wins, frozen result ignores later events', () => {
  let state = onlyLastEnemies();
  state = advanceMissionTick(state, {
    missionId: state.missionId,
    enemyIds: state.enemies.filter(item => item.status === 'active').map(item => item.id),
  });
  assert.equal(state.outcome, 'victory');
  assert.equal(state.phase, 'result');
  assert.equal(state.finalized, true);
  assert.equal(state.losses.enemies, 100);
  assert.equal(getRosterCounts(state).enemies.remaining, 0);
  assert.strictEqual(ticks(state, 600), state);
  assert.strictEqual(completeMissionTick(state, {
    missionId: state.missionId, aircraftIds: ['A001'], shipIds: ['S001'], enemyIds: ['E100'],
  }), state);
  assert.strictEqual(acknowledgeInputRelease(state, state.missionId, state.controlResetVersion), state);
});

test('A03/A04: all ships sunk stops reservations; simultaneous last enemy and ships is defeat', () => {
  let state = onlyLastEnemies();
  const pendingBefore = getRosterCounts(state).aircraft.pending;
  state = advanceMissionTick(state, {
    missionId: state.missionId, aircraftIds: ['A001'],
    enemyIds: state.enemies.filter(item => item.status === 'active').map(item => item.id),
    shipIds: state.ships.map(item => item.id).reverse(),
  });
  assert.equal(state.outcome, 'defeat');
  assert.equal(state.losses.enemies, 100);
  assert.equal(state.losses.ships, 10);
  assert.equal(state.losses.player, 1);
  assert.equal(getRosterCounts(state).aircraft.pending, pendingBefore);
  assert.equal(state.aircraft[8].status, 'reserve');
  assert.equal(state.handoff, null);
  assert.ok(state.ships.every(item => item.status === 'sunk' && item.hp === 0 && !item.ownsAttackSlot));
  assert.strictEqual(ticks(state, 1000), state);
});

test('A03: retry is one initialization path, old mission deaths/releases cannot affect new mission', () => {
  let old = kill(mission(), ['A001', 'A002']);
  old = acknowledgeInputRelease(old, old.missionId, old.controlResetVersion);
  const state = resetMission(old, { missionId: 'mission-2' });
  assert.equal(state.seed, old.seed);
  assert.equal(state.tick, 0);
  assert.equal(state.phase, 'playing');
  assert.equal(state.controlledAircraftId, 'A001');
  assert.equal(state.requiresInputRelease, true);
  assert.ok(state.controlResetVersion > old.controlResetVersion);
  assert.deepEqual(state.losses, { player: 0, wing: 0, enemies: 0, ships: 0 });
  assert.equal(getRosterCounts(state).aircraft.remaining, 50);
  assert.strictEqual(completeMissionTick(state, { missionId: old.missionId, aircraftIds: ['A001'] }), state);
  assert.strictEqual(advanceMissionTick(state, { missionId: old.missionId, aircraftIds: ['A001'] }), state);
  assert.strictEqual(acknowledgeInputRelease(state, old.missionId, old.controlResetVersion), state);
  assert.throws(() => resetMission(state, { missionId: state.missionId }), /fresh missionId/);
  assert.equal(ticks(state, AIRCRAFT_RESPAWN_TICKS + 1).aircraft[8].status, 'reserve');
});

test('deterministic batch permutations yield identical state and no caller mutation', () => {
  const original = mission();
  const left = advanceMissionTick(original, {
    missionId: original.missionId, aircraftIds: ['A001', 'A002', 'A006'], enemyIds: ['E001', 'E020'], shipIds: ['S003', 'S007'],
  });
  const right = advanceMissionTick(original, {
    missionId: original.missionId, aircraftIds: ['A006', 'A002', 'A001'], enemyIds: ['E020', 'E001'], shipIds: ['S007', 'S003'],
  });
  assert.deepEqual(left, right);
  assert.deepEqual(ticks(left, 240), ticks(right, 240));
  assert.equal(original.tick, 0);
  assert.equal(original.aircraft[0].status, 'active');
});

test('invariant checker catches duplicate reservations, invalid HP, roles and identity loss', () => {
  let state = kill(mission(), ['A001', 'A002']);
  state.aircraft[9].slot = state.aircraft[8].slot;
  assert.throws(() => assertRosterInvariants(state), /unique slot/);
  state = mission(); state.aircraft[0].hp = 81;
  assert.throws(() => assertRosterInvariants(state), /HP range/);
  state = mission(); state.aircraft[1].role = 'player';
  assert.throws(() => assertRosterInvariants(state), /one controlled aircraft/);
  state = mission(); state.enemies[99].id = 'E099';
  assert.throws(() => assertRosterInvariants(state), /unique identifiers/);
});


test('blocked spawn retains the original ID and deadline until the occupancy guard allows entry', () => {
  let state=advanceMissionTick(mission(),{missionId:'mission-1',aircraftIds:['A001'],enemyIds:['E001']});
  const aircraft=state.aircraft.find(a=>a.status==='pending' && a.slot===0)!;
  const enemy=state.enemies.find(e=>e.status==='pending')!;
  const aircraftDeadline=aircraft.reservation!.dueTick, enemyDeadline=enemy.reservation!.dueTick;
  while(state.tick < aircraftDeadline + 5) {
    state=completeMissionTick(beginMissionTick(state,()=>false),{missionId:state.missionId});
  }
  assert.equal(state.aircraft.find(a=>a.id===aircraft.id)!.reservation!.dueTick,aircraftDeadline);
  assert.equal(state.enemies.find(e=>e.id===enemy.id)!.reservation!.dueTick,enemyDeadline);
  assert.equal(state.controlledAircraftId,null);
  assertRosterInvariants(state);
  state=beginMissionTick(state,()=>true);
  assert.equal(state.controlledAircraftId,aircraft.id);
  assert.equal(state.enemies.find(e=>e.id===enemy.id)!.status,'active');
  assertRosterInvariants(state);
});
