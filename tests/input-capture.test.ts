import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { FlightControls, type FlightControlButtons } from '../src/input';

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const previousElement = Object.getOwnPropertyDescriptor(globalThis, 'Element');
const previousHTMLElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');

afterEach(() => {
  restoreGlobal('window', previousWindow);
  restoreGlobal('document', previousDocument);
  restoreGlobal('Element', previousElement);
  restoreGlobal('HTMLElement', previousHTMLElement);
});

function restoreGlobal(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

class FixtureElement extends EventTarget {
  readonly attributes = new Map<string, string>();
  readonly captured = new Set<number>();
  readonly classes = new Set<string>();
  readonly classList = {
    add: (name: string) => { this.classes.add(name); },
    remove: (name: string) => { this.classes.delete(name); },
  };
  readonly style = {
    left: '', top: '',
    setProperty: (_name: string, _value: string) => {},
    removeProperty: (_name: string) => {},
  };
  joystick: FixtureElement | null = null;

  constructor(readonly kind: string) { super(); }
  closest<T extends HTMLElement = HTMLElement>(selector: string): T | null {
    if (selector === '#app' && this.kind === 'app') return this as unknown as T;
    if (selector.includes(this.kind) && ['button', 'input', 'select', 'textarea', 'dialog'].includes(this.kind)) {
      return this as unknown as T;
    }
    return null;
  }
  querySelector<T extends Element = Element>(_selector: string): T | null {
    return this.joystick as unknown as T | null;
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  setPointerCapture(pointerId: number): void { this.captured.add(pointerId); }
  hasPointerCapture(pointerId: number): boolean { return this.captured.has(pointerId); }
  releasePointerCapture(pointerId: number): void { this.captured.delete(pointerId); }
  getBoundingClientRect(): DOMRect { return { left: 0, top: 0, width: 200, height: 200 } as DOMRect; }
}

function setup() {
  class FakeElement extends FixtureElement {}
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: FakeElement });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: FakeElement });
  const fakeWindow = new EventTarget() as EventTarget & { visualViewport?: undefined };
  const fakeDocument = Object.assign(new EventTarget(), {
    hidden: false,
    getElementById: () => null,
    createElement: (name: string) => new FakeElement(name),
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });

  const surface = new FakeElement('app');
  surface.joystick = new FakeElement('joystick');
  const buttons = Object.fromEntries(['fire', 'loop', 'accelerate', 'brake'].map(name => [name, new FakeElement('button')])) as unknown as FlightControlButtons;
  const controls = new FlightControls(surface as unknown as HTMLElement, buttons, () => true, undefined, 'normal');
  assert.equal(controls.acknowledgeRelease(), true);
  return { surface, buttons, controls, window: fakeWindow };
}

function pointerEvent(type: string, pointerId: number, isPrimary: boolean, clientX = 30, clientY = 30): PointerEvent {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId, pointerType: 'touch', isPrimary, button: 0, buttons: 1, clientX, clientY });
  return event as PointerEvent;
}

function keyEvent(type: string, code: string): KeyboardEvent {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, isComposing: false, repeat: false, ctrlKey: false, altKey: false, metaKey: false });
  return event as KeyboardEvent;
}

function endButton(button: FixtureElement, window: EventTarget, pointerId: number, isPrimary: boolean): void {
  button.dispatchEvent(pointerEvent('pointerup', pointerId, isPrimary));
  window.dispatchEvent(pointerEvent('pointerup', pointerId, isPrimary));
  button.dispatchEvent(pointerEvent('lostpointercapture', pointerId, isPrimary));
  // lostpointercapture bubbles to the app surface in a browser.
}

function bubbleLostCapture(surface: FixtureElement, pointerId: number, isPrimary: boolean): void {
  surface.dispatchEvent(pointerEvent('lostpointercapture', pointerId, isPrimary));
}

test('implicit button capture loss after its pointerup preserves an active steering pointer', () => {
  const { surface, buttons, controls, window } = setup();
  surface.dispatchEvent(pointerEvent('pointerdown', 1, true, 30, 30));
  window.dispatchEvent(pointerEvent('pointermove', 1, true, 80, 30));
  buttons.fire.dispatchEvent(pointerEvent('pointerdown', 2, false));
  assert.equal(controls.sample().turn, 1);
  assert.equal(controls.sample().fire, true);

  endButton(buttons.fire as unknown as FixtureElement, window, 2, false);
  bubbleLostCapture(surface, 2, false);

  const remaining = controls.sample();
  assert.equal(remaining.turn, 1);
  assert.equal(remaining.fire, false);
  assert.equal(controls.requiresRelease, false);
  assert.equal(controls.allReleased, false);
  controls.dispose();
});

test('implicit steering capture loss after its pointerup preserves an active fire pointer', () => {
  const { surface, buttons, controls, window } = setup();
  buttons.fire.dispatchEvent(pointerEvent('pointerdown', 2, true));
  surface.dispatchEvent(pointerEvent('pointerdown', 1, false, 30, 30));
  window.dispatchEvent(pointerEvent('pointermove', 1, false, 80, 30));
  assert.equal(controls.sample().fire, true);
  assert.equal(controls.sample().turn, 1);

  window.dispatchEvent(pointerEvent('pointerup', 1, false));
  surface.dispatchEvent(pointerEvent('lostpointercapture', 1, false));

  const remaining = controls.sample();
  assert.equal(remaining.fire, true);
  assert.equal(remaining.turn, 0);
  assert.equal(controls.requiresRelease, false);
  assert.equal(controls.allReleased, false);
  controls.dispose();
});

test('capture loss while its owner is active clears the action and requires release', () => {
  const { surface, buttons, controls, window } = setup();
  buttons.loop.dispatchEvent(pointerEvent('pointerdown', 3, true));
  assert.equal(controls.sample().loop, false);
  buttons.loop.dispatchEvent(pointerEvent('lostpointercapture', 3, true));

  assert.equal(controls.requiresRelease, true);
  assert.equal(controls.allReleased, false);
  assert.equal(controls.sample().loop, false);
  window.dispatchEvent(pointerEvent('pointerup', 3, true));
  assert.equal(controls.allReleased, true);
  assert.equal(controls.acknowledgeRelease(), true);

  surface.dispatchEvent(pointerEvent('pointerdown', 4, true, 30, 30));
  window.dispatchEvent(pointerEvent('pointermove', 4, true, 80, 30));
  assert.equal(controls.sample().turn, 1);
  surface.dispatchEvent(pointerEvent('lostpointercapture', 4, true));
  assert.equal(controls.requiresRelease, true);
  assert.equal(controls.sample().turn, 0);
  window.dispatchEvent(pointerEvent('pointerup', 4, true));
  assert.equal(controls.allReleased, true);
  controls.dispose();
});
