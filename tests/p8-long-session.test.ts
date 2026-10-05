import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  createSimulation,
  releaseSimulationInput,
  resetSimulation,
  stepSimulation,
  type SimulationState,
} from "../src/simulation";
import { projectileCounts, PROJECTILE_CAPACITIES } from "../src/projectiles";
import { attitudeQuaternion } from "../src/world-math";
import { FixedClock } from "../src/fixed-clock";

const TICKS_PER_TEN_MINUTES = 10 * 60 * 60;
const ZERO_INPUT = Object.freeze({ turn: 0, climb: 0, fire: false, loop: false });
const MAX_BURNS = 512;
const CHECKPOINT_EVERY = 6000;
const TEST_ONLY_RELOAD_DEADLINE = Number.MAX_SAFE_INTEGER;

function stateHash(state: SimulationState): string {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

function burnCount(state: SimulationState): number {
  return state.mission.aircraft.reduce((count, aircraft) => count + aircraft.burns.length, 0)
    + state.mission.ships.reduce((count, ship) => count + ship.burns.length, 0);
}

function disableWeaponsForLongLoadFixture(state: SimulationState): SimulationState {
  return {
    ...state,
    mission: {
      ...state.mission,
      aircraft: state.mission.aircraft.map((aircraft) => ({
        ...aircraft,
        machineGunAmmo: 0,
        cannonAmmo: 0,
        reloadUntilTick: TEST_ONLY_RELOAD_DEADLINE,
        nextMachineGunTick: TEST_ONLY_RELOAD_DEADLINE,
        nextCannonTick: TEST_ONLY_RELOAD_DEADLINE,
      })),
      enemies: state.mission.enemies.map((enemy) => ({
        ...enemy,
        ammunition: 0,
        reloadUntilTick: TEST_ONLY_RELOAD_DEADLINE,
        nextFireTick: TEST_ONLY_RELOAD_DEADLINE,
      })),
      ships: state.mission.ships.map((ship) => ({
        ...ship,
        ammunition: 0,
        reloadUntilTick: TEST_ONLY_RELOAD_DEADLINE,
        nextFireTick: TEST_ONLY_RELOAD_DEADLINE,
      })),
    },
  };
}

function runNoInputAtFrameRate(fps: number) {
  let state = createSimulation({ missionId: "p8-no-input-render-rate", seed: 20261005, mode: "easy", phase: "playing" });
  const clock = new FixedClock();
  const checkpoints: Array<{ call: number; tick: number; phase: string; hash: string }> = [];
  let maxLiveBurns = 0;
  let maxLiveEvents = 0;
  let maxObserved: Record<"aircraft" | "magic" | "antiAir", number> = { aircraft: 0, magic: 0, antiAir: 0 };
  let stepCalls = 0;
  let terminal = false;
  for (let frame = 0; frame <= fps * 600; frame += 1) {
    const shouldStop = clock.frame(frame * 1000 / fps, !terminal, () => {
      // The live no-input route releases controls again after each handoff/respawn.
      state = releaseSimulationInput(state);
      state = stepSimulation(state, ZERO_INPUT, "easy");
      stepCalls += 1;
      const counts = projectileCounts(state.projectiles);
      maxObserved = {
        aircraft: Math.max(maxObserved.aircraft, counts.aircraft),
        magic: Math.max(maxObserved.magic, counts.magic),
        antiAir: Math.max(maxObserved.antiAir, counts.antiAir),
      };
      maxLiveBurns = Math.max(maxLiveBurns, burnCount(state));
      maxLiveEvents = Math.max(maxLiveEvents, state.events.length);
      assert.ok(counts.aircraft <= PROJECTILE_CAPACITIES.aircraft, "aircraft projectile pool stays bounded");
      assert.ok(counts.magic <= PROJECTILE_CAPACITIES.magic, "magic projectile pool stays bounded");
      assert.ok(counts.antiAir <= PROJECTILE_CAPACITIES.antiAir, "anti-air projectile pool stays bounded");
      assert.ok(burnCount(state) <= MAX_BURNS, "burn records stay within the fixed capacity");
      if (state.mission.tick % CHECKPOINT_EVERY === 0) {
        checkpoints.push({ call: stepCalls, tick: state.mission.tick, phase: state.mission.phase, hash: stateHash(state) });
      }
      terminal = state.mission.phase !== "playing";
      if (terminal && checkpoints.at(-1)?.tick !== state.mission.tick) {
        checkpoints.push({ call: stepCalls, tick: state.mission.tick, phase: state.mission.phase, hash: stateHash(state) });
      }
      return !terminal;
    });
    assert.equal(shouldStop, false, `${fps} fps does not overload the fixed clock`);
  }
  return {
    state,
    fps,
    stepCalls,
    checkpoints,
    metrics: {
      maxObserved,
      maxLiveBurns,
      maxLiveEvents,
      ...state.metrics,
      finalTick: state.mission.tick,
      finalPhase: state.mission.phase,
      outcome: state.mission.outcome,
      resultTick: state.result?.tick ?? null,
      resultReason: state.result?.reason ?? null,
      completedActiveSeconds: state.mission.tick / 60,
      scheduledTicksNotRunAfterTerminal: state.result ? TICKS_PER_TEN_MINUTES - state.result.tick : 0,
      losses: state.mission.losses,
      score: state.result?.score ?? null,
      finalHash: stateHash(state),
    },
  };
}

test("P8: 30/60/120 fps render schedules produce matching no-input world hashes and bounded pools", { timeout: 600_000 }, (t) => {
  const runs = [30, 60, 120].map(runNoInputAtFrameRate);
  const [first, ...rest] = runs;
  for (const run of rest) {
    assert.deepEqual(run.checkpoints, first.checkpoints, `${run.fps} fps logical checkpoints match ${first.fps} fps`);
    assert.equal(run.metrics.finalHash, first.metrics.finalHash, `${run.fps} fps final full-state hash matches`);
    assert.deepEqual(run.metrics.maxObserved, first.metrics.maxObserved);
    assert.equal(run.metrics.maxLiveBurns, first.metrics.maxLiveBurns);
    assert.equal(run.metrics.maxLiveEvents, first.metrics.maxLiveEvents);
  }
  for (const [pool, max] of Object.entries(first.metrics.maxObserved)) {
    assert.ok(max <= PROJECTILE_CAPACITIES[pool as keyof typeof PROJECTILE_CAPACITIES]);
  }
  assert.ok(first.metrics.maxLiveBurns <= MAX_BURNS);
  assert.ok(first.metrics.maxLiveEvents <= 1024);
  assert.equal(first.metrics.poolBlockedAircraft, 0, "natural no-input load does not exhaust aircraft projectiles");
  assert.equal(first.metrics.poolBlockedMagic, 0, "natural no-input load does not exhaust magic projectiles");
  assert.equal(first.metrics.poolBlockedAntiAir, 0, "natural no-input load does not exhaust anti-air projectiles");
  assert.equal(first.stepCalls, first.metrics.finalTick, "result ends the active logical clock without catch-up ticks");
  t.diagnostic(JSON.stringify({
    seed: 20261005,
    mode: "easy",
    scheduledWallSeconds: 600,
    requestedSimulationTicks: TICKS_PER_TEN_MINUTES,
    runs: runs.map(({ fps, stepCalls, checkpoints, metrics }) => ({ fps, stepCalls, checkpoints, metrics })),
  }));
});

test("P8: five retries start with fresh logical resources and stable capacities", { timeout: 120_000 }, () => {
  const zeroMetrics = {
    poolBlockedAircraft: 0,
    poolBlockedMagic: 0,
    poolBlockedAntiAir: 0,
    maxAircraftProjectiles: 0,
    maxMagicProjectiles: 0,
    maxAntiAirProjectiles: 0,
    maxBurns: 0,
    maxEvents: 0,
    aircraftShots: 0,
    enemyShots: 0,
    shipShots: 0,
  };
  let state = createSimulation({ missionId: "p8-retry-0", seed: 5050, mode: "easy", phase: "playing" });
  state = releaseSimulationInput(state);
  for (let retry = 1; retry <= 5; retry += 1) {
    for (let tick = 0; tick < 1200; tick += 1) {
      state = releaseSimulationInput(state);
      state = stepSimulation(state, ZERO_INPUT, "easy");
    }
    const counts = projectileCounts(state.projectiles);
    assert.ok(counts.aircraft <= PROJECTILE_CAPACITIES.aircraft);
    assert.ok(counts.magic <= PROJECTILE_CAPACITIES.magic);
    assert.ok(counts.antiAir <= PROJECTILE_CAPACITIES.antiAir);
    assert.ok(burnCount(state) <= MAX_BURNS);
    state = resetSimulation(state, { missionId: `p8-retry-${retry}`, seed: 5050, mode: "easy", phase: "playing" });
    state = releaseSimulationInput(state);
    assert.equal(state.mission.tick, 0);
    assert.equal(state.mission.finalized, false);
    assert.equal(state.mission.phase, "playing");
    assert.equal(state.projectiles.length, 0);
    assert.equal(state.nextProjectileOrdinal, 1);
    assert.deepEqual(state.poolCapacities, PROJECTILE_CAPACITIES);
    assert.deepEqual(state.metrics, zeroMetrics);
    assert.equal(burnCount(state), 0);
    assert.equal(Object.keys(state.world.aircraft).length, 8);
    assert.equal(Object.keys(state.world.enemies).length, 24);
    assert.equal(Object.keys(state.world.ships).length, 10);
  }
});

test("P8: a nonterminal 10-minute world-load fixture keeps entity and resource counts bounded", { timeout: 600_000 }, (t) => {
  let state = createSimulation({ missionId: "p8-10m-active-fixture", seed: 7070, mode: "normal", phase: "playing" });
  state = releaseSimulationInput(state);
  const checkpoints: Array<{ tick: number; counts: Record<string, number>; hash: string }> = [];
  const input = Object.freeze({ turn: 0.3, climb: 0, fire: false, loop: false });
  let maxProjectiles = 0;
  let maxBurns = 0;
  let maxEvents = 0;
  for (let tick = 1; tick <= TICKS_PER_TEN_MINUTES; tick += 1) {
    state = disableWeaponsForLongLoadFixture(state);
    state = releaseSimulationInput(state);
    state = stepSimulation(state, input, "normal");
    const counts = projectileCounts(state.projectiles);
    maxProjectiles = Math.max(maxProjectiles, state.projectiles.length);
    maxBurns = Math.max(maxBurns, burnCount(state));
    maxEvents = Math.max(maxEvents, state.events.length);
    assert.equal(state.mission.phase, "playing", `fixture remains active at tick ${tick}`);
    assert.equal(state.mission.tick, tick, "mission clock advances for all ten active minutes");
    assert.equal(state.mission.aircraft.length, 50);
    assert.equal(state.mission.enemies.length, 100);
    assert.equal(state.mission.ships.length, 10);
    assert.ok(Object.keys(state.world.aircraft).length <= 8);
    assert.ok(Object.keys(state.world.enemies).length <= 24);
    assert.equal(Object.keys(state.world.ships).length, 10);
    assert.ok(counts.aircraft <= PROJECTILE_CAPACITIES.aircraft);
    assert.ok(counts.magic <= PROJECTILE_CAPACITIES.magic);
    assert.ok(counts.antiAir <= PROJECTILE_CAPACITIES.antiAir);
    assert.ok(burnCount(state) <= MAX_BURNS);
    assert.ok(state.events.length <= 1024);
    if (tick % CHECKPOINT_EVERY === 0) {
      checkpoints.push({
        tick,
        counts: {
          activeAircraft: state.mission.aircraft.filter((aircraft) => aircraft.status === "active").length,
          pendingAircraft: state.mission.aircraft.filter((aircraft) => aircraft.status === "pending").length,
          activeEnemies: state.mission.enemies.filter((enemy) => enemy.status === "active").length,
          pendingEnemies: state.mission.enemies.filter((enemy) => enemy.status === "pending").length,
          aliveShips: state.mission.ships.filter((ship) => ship.status === "alive").length,
          projectiles: state.projectiles.length,
          burns: burnCount(state),
          scoreEntries: Object.keys(state.score.enemies).length,
        },
        hash: stateHash(state),
      });
    }
  }
  assert.equal(state.mission.phase, "playing");
  assert.equal(state.mission.tick, TICKS_PER_TEN_MINUTES);
  assert.ok(maxProjectiles <= PROJECTILE_CAPACITIES.aircraft + PROJECTILE_CAPACITIES.magic + PROJECTILE_CAPACITIES.antiAir);
  assert.ok(maxBurns <= MAX_BURNS);
  assert.ok(maxEvents <= 1024);
  t.diagnostic(JSON.stringify({
    fixture: "full world movement; test-only weapon disabling; fixed orbit input",
    seed: 7070,
    activeTicks: state.mission.tick,
    seconds: state.mission.tick / 60,
    maxProjectiles,
    maxBurns,
    maxEvents,
    checkpoints,
  }));
});

test("P8: exhausted logical pools block all emitters without spending ammunition", () => {
  let state = createSimulation({
    missionId: "p8-forced-pool-block",
    seed: 6060,
    mode: "easy",
    phase: "playing",
    poolCapacities: { aircraft: 0, magic: 0, antiAir: 0 },
  });
  state = releaseSimulationInput(state);

  const playerPosition = { x: 2000, y: 700, z: 900 };
  const enemyPosition = { x: 2000, y: 700, z: 400 };
  const player = state.world.aircraft.A001;
  const enemy = state.world.enemies.E001;
  const quaternion = attitudeQuaternion(0, 0, 0);
  state = {
    ...state,
    mission: {
      ...state.mission,
      enemies: state.mission.enemies.map((item) => item.id === "E001" ? { ...item, entering: false } : item),
    },
    world: {
      ...state.world,
      aircraft: {
        ...state.world.aircraft,
        A001: {
          ...player,
          position: playerPosition,
          previousPosition: playerPosition,
          velocity: { x: 0, y: 0, z: -player.speed },
          forward: { x: 0, y: 0, z: -1 },
          yaw: 0,
          pitch: 0,
          bank: 0,
          quaternion,
          previousQuaternion: quaternion,
        },
      },
      enemies: {
        ...state.world.enemies,
        E001: {
          ...enemy,
          position: enemyPosition,
          previousPosition: enemyPosition,
          velocity: { x: 0, y: 0, z: -enemy.targetSpeed },
          forward: { x: 0, y: 0, z: -1 },
          yaw: 0,
          quaternion,
        },
      },
    },
  };

  const initialPlayer = state.mission.aircraft[0];
  const initialEnemy = state.mission.enemies[0];
  const initialShip = state.mission.ships[0];
  for (let tick = 0; tick < 2; tick += 1) state = stepSimulation(state, ZERO_INPUT, "easy");

  assert.ok(state.metrics.poolBlockedAircraft > 0, "player volleys wait for aircraft pool slots");
  assert.ok(state.metrics.poolBlockedMagic > 0, "enemy magic waits for pool slots");
  assert.ok(state.metrics.poolBlockedAntiAir > 0, "ship fire waits for pool slots");
  assert.equal(state.metrics.aircraftShots, 0);
  assert.equal(state.metrics.enemyShots, 0);
  assert.equal(state.metrics.shipShots, 0);
  assert.equal(state.projectiles.length, 0);
  assert.equal(state.mission.aircraft[0].machineGunAmmo, initialPlayer.machineGunAmmo);
  assert.equal(state.mission.aircraft[0].cannonAmmo, initialPlayer.cannonAmmo);
  assert.equal(state.mission.aircraft[0].nextMachineGunTick, initialPlayer.nextMachineGunTick);
  assert.equal(state.mission.aircraft[0].nextCannonTick, initialPlayer.nextCannonTick);
  assert.equal(state.mission.enemies[0].ammunition, initialEnemy.ammunition);
  assert.equal(state.mission.enemies[0].nextFireTick, initialEnemy.nextFireTick);
  assert.equal(state.mission.ships[0].ammunition, initialShip.ammunition);
  assert.equal(state.mission.ships[0].nextFireTick, initialShip.nextFireTick);
});
