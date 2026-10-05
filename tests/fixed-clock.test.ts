import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedClock } from '../src/fixed-clock';

test('accepted ticks agree across 30/60/120fps', () => {
  for (const fps of [30, 60, 120]) {
    const clock = new FixedClock(); let ticks = 0;
    for (let frame = 0; frame <= fps * 10; frame++) {
      assert.equal(clock.frame(frame * 1000 / fps, true, () => { ticks++; return true; }), false);
    }
    assert.equal(ticks, 600);
  }
});
test('pause and resume omit the wall time without catch-up', () => {
  const clock = new FixedClock(); let ticks = 0;
  const step = () => { ticks++; return true; };
  clock.frame(0, true, step); clock.frame(100, true, step);
  clock.frame(10000, false, step); clock.frame(20000, true, step);
  assert.equal(ticks, 6);
  clock.frame(20100, true, step); assert.equal(ticks, 12);
});
test('per-frame budget is eight and repeated overload requests a stop', () => {
  const clock = new FixedClock(); let ticks = 0;
  const step = () => { ticks++; return true; };
  clock.frame(0, true, step);
  assert.equal(clock.frame(500, true, step), false); assert.equal(ticks, 8);
  assert.equal(clock.frame(1000, true, step), false); assert.equal(ticks, 16);
  assert.equal(clock.frame(1500, true, step), true); assert.equal(ticks, 24);
});
test('terminal step prevents further ticks in the same frame', () => {
  const clock = new FixedClock(); let ticks = 0;
  clock.frame(0, true, () => true);
  clock.frame(100, true, () => { ticks++; return false; });
  assert.equal(ticks, 1);
});


test('one-second or longer gaps stop before applying suspended input', () => {
  for (const gapMilliseconds of [1000, 1001, 5000]) {
    const clock = new FixedClock();
    let ticks = 0;
    const step = () => { ticks++; return true; };
    clock.frame(100, true, step);
    assert.equal(clock.frame(100 + gapMilliseconds, true, step), true);
    assert.equal(ticks, 0, `${gapMilliseconds} ms gap does not execute stale input`);
    assert.equal(clock.interpolation, 0);

    // After explicit resume, the first frame establishes a fresh epoch.
    assert.equal(clock.frame(200 + gapMilliseconds, true, step), false);
    assert.equal(ticks, 0);
    assert.equal(clock.frame(300 + gapMilliseconds, true, step), false);
    assert.equal(ticks, 6);
  }
});

test('a sub-second gap retains the existing eight-tick overload budget', () => {
  const clock = new FixedClock();
  let ticks = 0;
  const step = () => { ticks++; return true; };
  clock.frame(100, true, step);
  assert.equal(clock.frame(1099, true, step), false);
  assert.equal(ticks, 8);
});

test('a long gap cannot finalize a mission before the pause is shown', () => {
  const clock = new FixedClock();
  let finalized = false;
  clock.frame(100, true, () => true);
  assert.equal(clock.frame(1100, true, () => { finalized = true; return false; }), true);
  assert.equal(finalized, false);
});
