import assert from 'node:assert/strict';
import test from 'node:test';
import { addBurn, applyIceHit, expireIce, iceAdjustedSpeed, integrateBurns, isIceActive, remainingIceSeconds } from '../src/status-effects.ts';
import type { BurnState } from '../src/roster.ts';

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('A10: each fireball integrates exactly 8 HP over its own one-second interval at 30/60 Hz', () => {
  const burns = addBurn([], 'P1', 'A001', 0, 0);
  near(integrateBurns(80, burns, 0, 1).hp, 72);
  for (const partitions of [30, 60, 120]) {
    let hp = 80;
    let effects = burns;
    for (let tick = 0; tick < partitions; tick += 1) {
      const step = integrateBurns(hp, effects, tick / partitions, (tick + 1) / partitions);
      hp = step.hp; effects = step.burns;
    }
    near(hp, 72);
    assert.equal(effects.length, 0);
  }
});

test('A10: staggered fireballs retain separate intervals and integrate fractional overlap', () => {
  const first = addBurn([], 'P1', 'A001', 0, 0);
  const both = addBurn(first, 'P2', 'A001', 0.3, 1);
  near(integrateBurns(80, both, 0, 1.3).damage, 16);
  near(integrateBurns(80, both, 0.2, 0.4).damage, 2.4);
  const tail = integrateBurns(80, both, 1, 1.1);
  near(tail.damage, 0.8);
  assert.deepEqual(tail.burns.map(effect => effect.projectileId), ['P2']);
  assert.equal(first[0].endsAtSeconds, 1);
  assert.equal(both[1].endsAtSeconds, 1.3);
});

test('A10: exact burn death clamps HP once and discards residual effects', () => {
  let burns = addBurn([], 'P1', 'A001', 0, 0);
  burns = addBurn(burns, 'P2', 'A001', 0, 1);
  const step = integrateBurns(1, burns, 0, 1);
  near(step.deathAtSeconds!, 1 / 16);
  assert.equal(step.damage, 1);
  assert.equal(step.hp, 0);
  assert.deepEqual(step.burns, []);
  assert.equal(integrateBurns(0, burns, 1, 2).damage, 0);
});

test('A10/A18: duplicate impact IDs do not add fire; 296 concentrated hits fit the shared 512 pool', () => {
  let burns: BurnState[] = [];
  for (let index = 0; index < 296; index += 1) burns = addBurn(burns, `P${index}`, 'A001', 1, burns.length);
  assert.equal(burns.length, 296);
  assert.equal(addBurn(burns, 'P0', 'A001', 1, 296).length, 296);
  for (let index = 296; index < 512; index += 1) burns = addBurn(burns, `P${index}`, 'A001', 1, burns.length);
  assert.equal(burns.length, 512);
  assert.throws(() => addBurn(burns, 'overflow', 'A001', 1, 512), /capacity/);
  assert.throws(() => addBurn([], 'overflow', 'A002', 1, 512), /capacity/);
});

test('A11: ice begins next tick, lasts exactly 300 ticks and subtracts 50/3.6 only once', () => {
  const ice = applyIceHit(null, 60);
  assert.deepEqual(ice, { startsAtTick: 61, expiresAtTick: 361 });
  assert.equal(isIceActive(ice, 60), false);
  assert.equal(isIceActive(ice, 61), true);
  assert.equal(isIceActive(ice, 360), true);
  assert.equal(isIceActive(ice, 361), false);
  near(iceAdjustedSpeed(110, ice, 61, 'aircraft') * 3.6, 346);
  near(iceAdjustedSpeed(110, ice, 62, 'aircraft') * 3.6, 346);
  assert.equal(iceAdjustedSpeed(65, ice, 61, 'aircraft'), 65);
  assert.equal(iceAdjustedSpeed(6, ice, 61, 'ship'), 0);
  assert.equal(iceAdjustedSpeed(110, ice, 361, 'aircraft'), 110);
  assert.equal(iceAdjustedSpeed(6, ice, 361, 'ship'), 6);
  assert.equal(expireIce(ice, 361), null);
});

test('A11: a hit at 4.9 seconds refreshes from next tick rather than adding five seconds', () => {
  const ice = applyIceHit(null, 0);
  const repeat = applyIceHit(ice, 294);
  assert.deepEqual(repeat, { startsAtTick: 1, expiresAtTick: 595 });
  assert.equal(remainingIceSeconds(repeat, 295), 5);
  assert.equal(isIceActive(repeat, 594), true);
  assert.equal(isIceActive(repeat, 595), false);
  assert.deepEqual(applyIceHit(applyIceHit(null, 8), 8), { startsAtTick: 9, expiresAtTick: 309 });
});
