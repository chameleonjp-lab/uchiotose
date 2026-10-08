import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { throttleAxisFromRaw, throttleAxisFromClientY, combineThrottleAxes, resolveThrottleAxis } from '../src/throttle-lever';
import { advanceThrottle, createFlightController } from '../src/flight';
import { createSimulation, releaseSimulationInput, stepSimulation } from '../src/simulation';
import { FlightControls } from '../src/input';
import { FixedClock } from '../src/fixed-clock';
import { DEFAULT_KEY_BINDINGS } from '../src/keyboard-settings';

const fixture = JSON.parse(readFileSync(new URL('../docs/fixtures/throttle-lever-v1.json', import.meta.url), 'utf8'));
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const neutral = { turn: 0, climb: 0, fire: false, loop: false };
function meta() { return createFlightController(createSimulation({ missionId: 'throttle-unit' }).world.aircraft.A001); }

class NodeStub extends EventTarget {
  attrs = new Map<string, string>(); captured = new Set<number>(); failCapture = false;
  rect = { left: 0, top: 100, width: 72, height: 144 }; offsetHeight = 0;
  style = { left: '', top: '', setProperty() {}, removeProperty() {} };
  classList = { add() {}, remove() {} }; disabled = false;
  constructor(readonly kind = 'div') { super(); }
  getAttribute(key: string) { return this.attrs.get(key) ?? null; }
  setAttribute(key: string, value: string) { this.attrs.set(key, value); }
  getBoundingClientRect() { return { ...this.rect, bottom: this.rect.top + this.rect.height }; }
  closest(selector: string) {
    if (selector === '#app' && this.kind === 'app') return this;
    if (selector.includes('[role="slider"]') && this.attrs.get('role') === 'slider') return this;
    if (selector.includes('button') && this.kind === 'button') return this;
    return null;
  }
  querySelector() { return new NodeStub(); }
  setPointerCapture(id: number) { if (this.failCapture) throw new Error('denied'); this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
}
function pointer(type: string, id: number, y = 122, extra = {}) {
  return Object.assign(new Event(type, { cancelable: true }), { pointerId: id, clientX: 36, clientY: y, pointerType: 'touch', button: 0, buttons: 1, isPrimary: false, ...extra });
}
function setup() {
  const old = ['window', 'document', 'Element', 'HTMLElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const win = Object.assign(new EventTarget(), { visualViewport: new EventTarget() });
  const doc = Object.assign(new EventTarget(), { hidden: false, getElementById: () => null });
  for (const [key, value] of [['window', win], ['document', doc], ['Element', NodeStub], ['HTMLElement', NodeStub]] as const) Object.defineProperty(globalThis, key, { configurable: true, value });
  const surface = new NodeStub('app'), throttle = new NodeStub(), fire = new NodeStub('button'), loop = new NodeStub('button');
  throttle.setAttribute('role', 'slider'); let active = true;
  const controls = new FlightControls(surface as any, { throttle, fire, loop } as any, () => active, undefined, 'normal');
  controls.acknowledgeRelease();
  const key = (type: string, code: string, target?: NodeStub, extra = {}) => {
    const event = Object.assign(new Event(type, { cancelable: true }), { code, repeat: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, ...extra });
    if (target) Object.defineProperty(event, 'target', { value: target });
    win.dispatchEvent(event); return event;
  };
  return { win, doc, surface, throttle, fire, loop, controls, key, setActive(value: boolean) { active = value; }, cleanup() {
    controls.dispose(); for (const [key, descriptor] of old) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }};
}
for (const [index, row] of fixture.axis.entries()) test(`contract axis ${index + 1}`, () => near(throttleAxisFromRaw(row.raw), row.expected));
for (const [index, row] of fixture.pointer.entries()) test(`contract pointer ${index + 1} crosses production input and target-speed path`, () => {
  const f = setup(); try {
    f.throttle.rect = { left: 0, top: row.top - 22, width: 72, height: row.bottom - row.top + 44 };
    f.throttle.dispatchEvent(pointer('pointerdown', 1, row.y));
    const input = f.controls.sample(); near(input.throttle!, row.expected);
    const controller = meta(); near(advanceThrottle(controller, input, 'normal', 1), 110 + row.expected * 18);
  } finally { f.cleanup(); }
});
for (const [index, row] of fixture.combine.entries()) test(`contract combine ${index + 1} crosses production sample`, () => {
  const f = setup(); try {
    const raw = row.pointer === 0 ? 0 : Math.sign(row.pointer) * (.08 + Math.abs(row.pointer) * .92);
    f.throttle.dispatchEvent(pointer('pointerdown', 1, 122 + (1 - raw) * 50));
    if (row.accelerate) f.key('keydown', 'KeyW'); if (row.brake) f.key('keydown', 'KeyS');
    if (row.focused) f.key('keydown', 'ArrowUp', f.throttle);
    const input = f.controls.sample(); near(input.throttle!, row.expected);
    near(advanceThrottle(meta(), input, 'normal', 1), 110 + row.expected * 18);
    near(combineThrottleAxes(row.pointer, row.accelerate, row.brake, row.focused), row.expected);
  } finally { f.cleanup(); }
});
for (const [index, row] of fixture.advance.entries()) test(`contract advance ${index + 1} uses product aerodynamic controller`, () => {
  const controller = meta(); controller.playerTargetSpeed = row.start;
  near(advanceThrottle(controller, { ...neutral, throttle: row.axis }, row.mode, row.dt), row.expected);
});
test('nonfinite/invalid geometry is neutral, explicit zero defeats legacy, legacy is retained only when unspecified', () => {
  for (const value of [NaN, Infinity, -Infinity]) { assert.equal(throttleAxisFromRaw(value), 0); assert.equal(throttleAxisFromClientY(value, 0, 100), 0); assert.equal(resolveThrottleAxis({ throttle: value, accelerate: true }), 0); }
  for (const input of [{ throttle: 0, accelerate: true }, { throttle: NaN, accelerate: true }]) near(advanceThrottle(meta(), { ...neutral, ...input }, 'normal', 1), 110);
  near(advanceThrottle(meta(), { ...neutral, accelerate: true }, 'normal', 1), 128);
  near(advanceThrottle(meta(), { ...neutral, brake: true }, 'normal', 1), 92);
});
test('lever, steering and fire own separate fingers; foreign up and implicit capture loss cannot gate peers', () => {
  const f = setup(); try {
    f.surface.dispatchEvent(pointer('pointerdown', 1)); f.win.dispatchEvent(pointer('pointermove', 1, 122, { clientX: 90 }));
    f.fire.dispatchEvent(pointer('pointerdown', 2)); f.throttle.dispatchEvent(pointer('pointerdown', 3));
    assert.equal(f.controls.sample().fire, true); assert.equal(f.controls.sample().turn, 1); assert.equal(f.controls.sample().throttle, 1);
    f.throttle.dispatchEvent(pointer('pointerdown', 4, 222)); assert.equal(f.controls.peek().throttlePointer, 3);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) f.throttle.dispatchEvent(pointer(type, 4));
    assert.equal(f.controls.peek().throttlePointer, 3);
    f.win.dispatchEvent(pointer('pointermove', 3, 400)); assert.equal(f.controls.sample().throttle, -1);
    f.win.dispatchEvent(pointer('pointerup', 3)); f.throttle.dispatchEvent(pointer('lostpointercapture', 3));
    const input = f.controls.sample(); assert.equal(input.throttle, 0); assert.equal(input.turn, 1); assert.equal(input.fire, true); assert.equal(f.controls.requiresRelease, false);
    f.throttle.dispatchEvent(pointer('pointerdown', 1)); assert.equal(f.controls.peek().throttlePointer, null);
  } finally { f.cleanup(); }
});
test('capture loss is logical release, physical lift and simulation acknowledgement are both required', () => {
  const f = setup(); try {
    f.throttle.dispatchEvent(pointer('pointerdown', 3)); f.throttle.dispatchEvent(pointer('lostpointercapture', 3));
    assert.equal(f.controls.sample().throttle, 0); assert.equal(f.controls.allReleased, false); assert.equal(f.controls.acknowledgeRelease(), false);
    f.win.dispatchEvent(pointer('pointerup', 3)); assert.equal(f.controls.allReleased, true); assert.equal(f.controls.requiresRelease, true);
    assert.equal(f.controls.sample().throttle, 0); assert.equal(f.controls.acknowledgeRelease(), true);
    f.throttle.dispatchEvent(pointer('pointerdown', 4)); assert.equal(f.controls.sample().throttle, 1);
  } finally { f.cleanup(); }
});
test('fresh primary retires stale same-ID ownership while preserving other device owners', () => {
  const f = setup(); try {
    f.fire.dispatchEvent(pointer('pointerdown', 9, 122, { pointerType: 'pen' }));
    f.throttle.dispatchEvent(pointer('pointerdown', 1, 122, { isPrimary: true }));
    f.throttle.dispatchEvent(pointer('pointerdown', 1, 222, { isPrimary: true }));
    assert.equal(f.controls.peek().throttlePointer, 1); assert.equal(f.controls.sample().throttle, -1); assert.equal(f.controls.sample().fire, true);
    f.controls.clear(); f.throttle.dispatchEvent(pointer('pointerdown', 1, 122, { isPrimary: true }));
    assert.equal(f.controls.peek().throttlePointer, null); assert.equal(f.controls.allReleased, false);
    f.win.dispatchEvent(pointer('pointerup', 1)); f.win.dispatchEvent(pointer('pointerup', 9, 122, { pointerType: 'pen' }));
    assert.equal(f.controls.acknowledgeRelease(), true);
  } finally { f.cleanup(); }
});
for (const source of ['global', 'remapped', 'focused', 'pointer']) test(`short ${source} pulse survives zero ticks and runs once in eight-tick catchup`, () => {
  const f = setup(); try {
    if (source === 'remapped') { f.controls.keyboard.apply({ ...DEFAULT_KEY_BINDINGS, accelerate: 'KeyQ' }); f.controls.acknowledgeRelease(); }
    if (source === 'pointer') { f.throttle.dispatchEvent(pointer('pointerdown', 1)); f.win.dispatchEvent(pointer('pointerup', 1)); }
    else { const code = source === 'focused' ? 'ArrowUp' : source === 'remapped' ? 'KeyQ' : 'KeyW'; f.key('keydown', code, source === 'focused' ? f.throttle : undefined); f.key('keyup', code, source === 'focused' ? f.throttle : undefined); }
    const clock = new FixedClock(), controller = meta(); let ticks = 0; const axes: number[] = [];
    const frame = (now: number) => { const input = f.controls.sample(false); return clock.frame(now, true, () => { const throttle = f.controls.sampleThrottle(); axes.push(throttle); advanceThrottle(controller, { ...input, throttle }, 'normal', 1 / 60); ticks++; return true; }); };
    frame(0); frame(5); frame(10); assert.equal(ticks, 0); assert.equal(f.controls.sample(false).throttle, 1);
    frame(150); assert.equal(ticks, 8); assert.deepEqual(axes, [1, 0, 0, 0, 0, 0, 0, 0]); near(controller.playerTargetSpeed, 110.3);
  } finally { f.cleanup(); }
});
test('held and opposed keys, remapping, slider focus and physical holds do not double-count', () => {
  const f = setup(); try {
    f.key('keydown', 'KeyW'); f.key('keydown', 'KeyS'); assert.equal(f.controls.sampleThrottle(), 0);
    f.key('keyup', 'KeyW'); f.key('keyup', 'KeyS'); assert.equal(f.controls.sampleThrottle(), 0);
    f.key('keydown', 'ArrowUp'); assert.equal(f.controls.sample().climb, 1);
    f.throttle.dispatchEvent(new Event('focusin')); assert.equal(f.controls.sample().climb, 0);
    f.key('keydown', 'ArrowUp', f.throttle, { repeat: true }); assert.equal(f.controls.sampleThrottle(), 0); f.key('keyup', 'ArrowUp', f.throttle);
    f.key('keydown', 'ArrowUp', f.throttle); assert.equal(f.controls.sample().climb, 0); assert.equal(f.controls.sampleThrottle(), 1);
    f.controls.clear(); assert.equal(f.controls.allReleased, false); assert.equal(f.controls.acknowledgeRelease(), false);
    f.key('keyup', 'ArrowUp', f.throttle); assert.equal(f.controls.acknowledgeRelease(), true); assert.equal(f.controls.sampleThrottle(), 0);
  } finally { f.cleanup(); }
});
test('clear, blur, hidden, pagehide, orientation, resize, settings, mode and generation boundaries discard pending throttle', () => {
  const f = setup(); try {
    const stops = [() => f.controls.clear(), ...['blur', 'pagehide', 'resize', 'orientationchange'].map(type => () => f.win.dispatchEvent(new Event(type))), () => f.win.visualViewport.dispatchEvent(new Event('resize')), () => { f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange')); f.doc.hidden = false; }, () => f.controls.keyboard.apply(DEFAULT_KEY_BINDINGS), () => f.controls.setMode('easy'), () => f.setActive(false)];
    for (const stop of stops) {
      f.setActive(true); f.controls.setMode('normal'); f.controls.acknowledgeRelease();
      f.key('keydown', 'KeyW'); f.key('keyup', 'KeyW'); assert.equal(f.controls.sample(false).throttle, 1); stop(); assert.equal(f.controls.sampleThrottle(), 0);
    }
    const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    assert.match(source, /controlResetVersion[\s\S]*?ui\.controls\.clear\(\)[\s\S]*?input = \{[^}]*throttle: 0/);
    assert.match(source, /ui\.controls\.sample\(false\)/); assert.match(source, /throttle: ui\.controls\.sampleThrottle\(\)/);
  } finally { f.cleanup(); }
});
test('pointer cancel, failed capture, mouse-buttons zero, and disabled modes never leave a pending pulse', () => {
  for (const terminal of ['pointercancel', 'lostpointercapture', 'capture-failure', 'mouse-zero']) {
    const f = setup(); try {
      f.throttle.failCapture = terminal === 'capture-failure';
      f.throttle.dispatchEvent(pointer('pointerdown', 1, 122, { pointerType: terminal === 'mouse-zero' ? 'mouse' : 'touch' }));
      if (terminal === 'mouse-zero') f.win.dispatchEvent(pointer('pointermove', 1, 122, { pointerType: 'mouse', buttons: 0 }));
      else if (terminal !== 'capture-failure') (terminal === 'lostpointercapture' ? f.throttle : f.win).dispatchEvent(pointer(terminal, 1));
      assert.equal(f.controls.sampleThrottle(), 0); f.win.dispatchEvent(pointer('pointerup', 1)); f.controls.acknowledgeRelease(); assert.equal(f.controls.sampleThrottle(), 0);
    } finally { f.cleanup(); }
  }
  const f = setup(); try {
    for (const extra of [{button: 2}, {pointerType: 'pen', button: 2}]) { f.throttle.dispatchEvent(pointer('pointerdown', 3, 122, extra)); assert.equal(f.controls.peek().throttlePointer, null); }
    f.throttle.setAttribute('aria-disabled', 'true'); f.throttle.dispatchEvent(pointer('pointerdown', 3)); assert.equal(f.controls.sampleThrottle(), 0);
    f.controls.setMode('easy'); f.controls.acknowledgeRelease(); f.key('keydown', 'KeyW'); assert.equal(f.controls.sampleThrottle(), 0);
  } finally { f.cleanup(); }
});
test('IME, shortcuts, focusout and repeat discard invalidated focused commands', () => {
  const f = setup(); try {
    f.key('keydown', 'ArrowUp', f.throttle, { isComposing: true }); assert.equal(f.controls.sampleThrottle(), 0);
    f.key('keydown', 'ArrowUp', f.throttle); f.key('keyup', 'ArrowUp', f.throttle); f.throttle.dispatchEvent(new Event('focusout')); assert.equal(f.controls.sampleThrottle(), 0);
    f.key('keydown', 'ArrowUp', f.throttle, { repeat: true }); assert.equal(f.controls.sampleThrottle(), 0);
    f.key('keydown', 'ArrowUp', f.throttle); f.key('keydown', 'KeyQ', f.throttle, { ctrlKey: true }); assert.equal(f.controls.sampleThrottle(), 0);
    assert.equal(f.controls.allReleased, false); f.key('keyup', 'ArrowUp', f.throttle); assert.equal(f.controls.acknowledgeRelease(), true);
  } finally { f.cleanup(); }
});
test('actual product simulation uses lever targets, holds after release, and retains finite forces and ice separation', () => {
  const f = setup(); try {
    let state = releaseSimulationInput(createSimulation({ missionId: 'lever', phase: 'playing', mode: 'normal' }));
    f.throttle.dispatchEvent(pointer('pointerdown', 1));
    state = stepSimulation(state, f.controls.sample(), 'normal'); near(state.world.aircraft.A001.controller.playerTargetSpeed, 110.3);
    f.win.dispatchEvent(pointer('pointerup', 1)); state = stepSimulation(state, f.controls.sample(), 'normal'); near(state.world.aircraft.A001.controller.playerTargetSpeed, 110.3);
    assert.equal(state.mission.aircraft.length, 50); assert.equal(state.mission.enemies.length, 100); assert.equal(state.mission.ships.length, 10);
    const frozen = structuredClone(state); frozen.mission.aircraft[0].ice = { startsAtTick: frozen.mission.tick, expiresAtTick: frozen.mission.tick + 300 };
    const plain = stepSimulation(state, {...neutral, throttle: .5}, 'normal'), iced = stepSimulation(frozen, {...neutral, throttle: .5}, 'normal');
    near(iced.world.aircraft.A001.controller.playerTargetSpeed, plain.world.aircraft.A001.controller.playerTargetSpeed);
    near(iced.mission.aircraft[0].baseSpeedMps, plain.mission.aircraft[0].baseSpeedMps);
    near(iced.mission.aircraft[0].actualSpeedMps, iced.mission.aircraft[0].baseSpeedMps - 50 / 3.6);
  } finally { f.cleanup(); }
});
test('actual product simulation and input agree at 30/60/120fps; one-second gap consumes no pulse', () => {
  const results = [30, 60, 120].map(fps => {
    const f = setup(); try {
      let state = releaseSimulationInput(createSimulation({missionId: 'fps-lever', seed: 20261005, mode: 'normal', phase: 'playing'}));
      const clock = new FixedClock(); f.key('keydown', 'KeyW');
      for (let frame = 0; frame <= fps * 2; frame++) { const input = f.controls.sample(false); clock.frame(frame * 1000 / fps, true, () => {state = stepSimulation(state, {...input, throttle: f.controls.sampleThrottle()}, 'normal'); return true;}); }
      return state;
    } finally { f.cleanup(); }
  });
  assert.deepEqual(results[0], results[1]); assert.deepEqual(results[1], results[2]); assert.equal(results[0].mission.tick, 120);
  const f = setup(); try { const clock = new FixedClock(); let ticks = 0; clock.frame(0, true, () => true); f.key('keydown', 'KeyW'); f.key('keyup', 'KeyW'); assert.equal(clock.frame(1000, true, () => {f.controls.sampleThrottle(); ticks++; return true;}), true); assert.equal(ticks, 0); f.controls.clear(); f.controls.acknowledgeRelease(); assert.equal(f.controls.sampleThrottle(), 0); } finally { f.cleanup(); }
});
test('a sampled pointer hold changed to a new fractional axis before up delivers the new axis for one tick', () => {
  const f = setup(); try {
    f.throttle.dispatchEvent(pointer('pointerdown',1)); assert.equal(f.controls.sampleThrottle(),1);
    f.win.dispatchEvent(pointer('pointermove',1,145)); f.win.dispatchEvent(pointer('pointerup',1));
    near(f.controls.sample(false).throttle!, .5); near(f.controls.sample(false).throttle!, .5);
    near(f.controls.sampleThrottle(), .5); assert.equal(f.controls.sampleThrottle(),0);
    for(const stop of [()=>f.throttle.dispatchEvent(new Event('focusout')),()=>f.key('keydown','Escape',f.throttle),()=>f.controls.keyboard.apply(DEFAULT_KEY_BINDINGS)]) {
      f.controls.acknowledgeRelease(); f.throttle.dispatchEvent(pointer('pointerdown',2)); f.win.dispatchEvent(pointer('pointerup',2)); assert.equal(f.controls.sample(false).throttle,1); stop(); assert.equal(f.controls.sampleThrottle(),0);
    }
  } finally { f.cleanup(); }
});
test('legacy controls without a lever do not emit a neutral analog field over old acceleration or assistive click', () => {
  const f=setup();const controls=new FlightControls(f.surface as any,{fire:f.fire,loop:f.loop,accelerate:new NodeStub('button'),brake:new NodeStub('button')} as any,()=>true,undefined,'normal');
  try {
    controls.acknowledgeRelease(); f.key('keydown','KeyW'); const held=controls.sample(); assert.equal(held.accelerate,true);assert.equal(held.throttle,undefined);near(advanceThrottle(meta(),held,'normal',1),128);
    f.key('keyup','KeyW'); assert.equal(controls.sample().accelerate,false);
    const legacy:any=controls; legacy.buttons.accelerate.dispatchEvent(Object.assign(new Event('click'),{detail:0})); const clicked=controls.sample();assert.equal(clicked.accelerate,true);assert.equal(clicked.throttle,undefined);near(advanceThrottle(meta(),clicked,'normal',1),128);
  } finally { controls.dispose();f.cleanup(); }
});
test('focused W/S and remapped speed holds cancel on focusout/Escape without reviving at keyup or cancelling global holds', () => {
  for(const code of ['KeyW','KeyS','KeyQ']) for(const stop of ['focusout','Escape']) {
    const f=setup(); try {
      if(code==='KeyQ') { f.controls.keyboard.apply({...DEFAULT_KEY_BINDINGS,accelerate:'KeyQ'});f.controls.acknowledgeRelease(); }
      f.key('keydown',code,f.throttle);assert.equal(f.controls.sample(false).throttle,code==='KeyS'?-1:1);
      if(stop==='focusout')f.throttle.dispatchEvent(new Event('focusout'));else f.key('keydown','Escape',f.throttle);
      assert.equal(f.controls.sample(false).throttle,0);assert.equal(f.controls.allReleased,false);
      f.key('keydown',code,f.throttle,{repeat:true});assert.equal(f.controls.sampleThrottle(),0);
      f.key('keyup',code,f.throttle);assert.equal(f.controls.sampleThrottle(),0);f.key('keyup','Escape',f.throttle);
      f.key('keydown',code);if(stop==='focusout')f.throttle.dispatchEvent(new Event('focusout'));else f.key('keydown','Escape',f.throttle);
      assert.equal(f.controls.sampleThrottle(),code==='KeyS'?-1:1,'a global speed hold belongs to global input');f.key('keyup',code);
    } finally { f.cleanup(); }
  }
  const f=setup();try {f.key('keydown','KeyW',f.throttle);f.key('keyup','KeyW',f.throttle);f.throttle.dispatchEvent(new Event('focusout'));assert.equal(f.controls.sampleThrottle(),0,'cancel a completed focused-key pulse too');}finally{f.cleanup();}
});
