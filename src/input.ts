/* Adapted from kaisen-reference/src/input.ts at 3d751051dc6212482a129e8da596ddd349b2f9f5. */
import {
  KeyboardSettings,
  keyboardEventHasShortcutModifier,
  type KeyAction,
} from './keyboard-settings';

export type FlightMode = 'normal' | 'easy';
export type FlightControlName = 'fire' | 'loop' | 'accelerate' | 'brake';
export type FlightControlButtons = Record<FlightControlName, HTMLButtonElement>;

/** Input accepted by the deterministic player-flight step. */
export interface FlightInput {
  turn: number;
  climb: number;
  fire: boolean;
  loop: boolean;
  accelerate: boolean;
  brake: boolean;
  steeringRevision: number;
}

const STEERING_ACTIONS = new Set<KeyAction>(['left', 'right', 'up', 'down']);
const NORMAL_ONLY_ACTIONS = new Set<KeyAction>(['fire', 'accelerate', 'brake']);
const INTERACTIVE_TARGETS = 'button, a[href], input, select, textarea, dialog, [contenteditable="true"], [data-no-steering]';

function neutralInput(steeringRevision: number): FlightInput {
  return { turn: 0, climb: 0, fire: false, loop: false, accelerate: false, brake: false, steeringRevision };
}

/** Owns keyboard, drag, and touch holds for the player's flight controls. */
export class FlightControls {
  private steerPointer: number | null = null;
  private steerPointerType: string | null = null;
  private readonly buttonPointerTypes = new Map<number, string>();
  private readonly holds: Record<FlightControlName, Set<number>> = {
    fire: new Set(), loop: new Set(), accelerate: new Set(), brake: new Set(),
  };
  private readonly controlNames: FlightControlName[];
  private readonly keys = new Set<string>();
  private readonly physicalKeys = new Set<string>();
  private readonly blockedKeys = new Set<string>();
  private readonly physicalPointers = new Set<number>();
  /** Retained across clear() so a new primary gesture can retire a lost old up event. */
  private readonly physicalPointerTypes = new Map<number, string>();
  private readonly blockedPointers = new Set<number>();
  private readonly clickBursts = new Set<FlightControlName>();
  private loopEdge = false;
  private turn = 0;
  private climb = 0;
  private steeringRevision = 0;
  private origin = { x: 0, y: 0 };
  private currentMode: FlightMode;
  private releaseGate = true;
  private readonly abort = new AbortController();
  private readonly joystick: HTMLElement;
  private readonly unsubscribeKeys: () => void;

  constructor(
    private readonly surface: HTMLElement,
    private readonly buttons: FlightControlButtons,
    private readonly active: () => boolean,
    readonly keyboard = new KeyboardSettings(),
    mode: FlightMode = 'easy',
  ) {
    this.currentMode = mode;
    this.controlNames = (Object.keys(buttons) as FlightControlName[]).filter(name => Boolean(buttons[name]));
    this.unsubscribeKeys = keyboard.subscribe(() => this.clear());
    const app = surface.closest<HTMLElement>('#app') ?? document.getElementById('app') ?? surface;
    let joystick = app.querySelector<HTMLElement>('#joystick');
    if (!joystick) {
      joystick = document.createElement('div');
      joystick.id = 'joystick';
      joystick.setAttribute('aria-hidden', 'true');
      joystick.innerHTML = '<i></i>';
      app.append(joystick);
    }
    this.joystick = joystick;

    const opts = { signal: this.abort.signal };
    surface.addEventListener('pointerdown', event => this.beginSteering(event, app), opts);
    window.addEventListener('pointermove', event => this.moveSteering(event), opts);
    window.addEventListener('pointerup', event => this.endPointer(event, true), opts);
    window.addEventListener('pointercancel', event => this.endPointer(event, false), opts);
    surface.addEventListener('lostpointercapture', event => this.loseSteeringCapture(event), opts);
    surface.addEventListener('contextmenu', event => event.preventDefault(), opts);

    for (const name of this.controlNames) {
      const button = buttons[name];
      button.setAttribute('data-flight-control', name);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('pointerdown', event => this.beginButton(name, button, event), opts);
      button.addEventListener('pointerup', event => this.endButton(name, button, event, true), opts);
      button.addEventListener('pointercancel', event => this.endButton(name, button, event, false), opts);
      button.addEventListener('lostpointercapture', event => this.loseButtonCapture(name, button, event), opts);
      button.addEventListener('click', event => {
        // Keep native keyboard and assistive-technology activation; pointer clicks
        // already emitted their action on pointerup.
        if (event.detail === 0 && this.active()) this.activateOnce(name);
      }, opts);
      button.addEventListener('contextmenu', event => event.preventDefault(), opts);
    }

    window.addEventListener('keydown', event => this.keyDown(event), opts);
    window.addEventListener('keyup', event => this.keyUp(event), opts);
    window.addEventListener('blur', () => this.clear(), opts);
    window.addEventListener('pagehide', () => this.clear(), opts);
    window.addEventListener('resize', () => this.clear(), opts);
    window.visualViewport?.addEventListener('resize', () => this.clear(), opts);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); }, opts);
  }

  /** True only after every key or pointer held through a reset has physically lifted. */
  get allReleased(): boolean {
    return this.physicalKeys.size === 0 && this.physicalPointers.size === 0;
  }

  /** Main acknowledges this after its simulation also accepts the input reset. */
  get requiresRelease(): boolean { return this.releaseGate; }

  get mode(): FlightMode { return this.currentMode; }

  peek() {
    return {
      turn: this.turn,
      climb: this.climb,
      steerPointer: this.steerPointer,
      heldPointers: Object.fromEntries(Object.entries(this.holds).map(([name, ids]) => [name, [...ids]])),
      keys: [...this.keys],
      physicalKeys: [...this.physicalKeys],
      blockedKeys: [...this.blockedKeys],
      physicalPointers: [...this.physicalPointers],
      physicalPointerTypes: [...this.physicalPointerTypes.entries()],
      blockedPointers: [...this.blockedPointers],
      requiresRelease: this.releaseGate,
    };
  }

  /** Returns the WorldInput-compatible player controls for one fixed tick. */
  sample(): FlightInput {
    if (!this.active()) {
      this.clear();
      return neutralInput(this.steeringRevision);
    }
    if (this.releaseGate) return neutralInput(this.steeringRevision);

    const keyHeld = (action: KeyAction) => this.keys.has(this.keyboard.code(action));
    const turn = this.turn + Number(keyHeld('right')) - Number(keyHeld('left'));
    const climb = this.climb + Number(keyHeld('up')) - Number(keyHeld('down'));
    const pressed = (name: FlightControlName) => this.holds[name].size > 0;
    const normal = this.currentMode === 'normal';
    const fire = normal && (pressed('fire') || keyHeld('fire') || this.clickBursts.has('fire'));
    const accelerate = normal && (pressed('accelerate') || keyHeld('accelerate') || this.clickBursts.has('accelerate'));
    const brake = normal && (pressed('brake') || keyHeld('brake') || this.clickBursts.has('brake'));
    const loop = this.loopEdge;
    this.loopEdge = false;
    this.clickBursts.clear();
    return {
      turn: Math.max(-1, Math.min(1, turn)),
      climb: Math.max(-1, Math.min(1, climb)),
      fire, loop, accelerate, brake,
      steeringRevision: this.steeringRevision,
    };
  }

  /** Mode changes release old holds and require a real lift before another action. */
  setMode(mode: FlightMode): void {
    if (mode !== 'normal' && mode !== 'easy') return;
    if (this.currentMode === mode) return;
    this.clear();
    this.currentMode = mode;
  }

  /** Block currently held controls until their matching physical up/cancel event. */
  clear(): void {
    for (const code of this.physicalKeys) this.blockedKeys.add(code);
    for (const pointer of this.physicalPointers) this.blockedPointers.add(pointer);
    this.releaseGate = true;
    const steeringPointer = this.steerPointer;
    this.steerPointer = null;
    this.steerPointerType = null;
    this.buttonPointerTypes.clear();
    this.turn = 0;
    this.climb = 0;
    this.keys.clear();
    this.loopEdge = false;
    this.clickBursts.clear();
    this.joystick.classList.remove('visible');
    this.joystick.style.removeProperty('--joystick-x');
    this.joystick.style.removeProperty('--joystick-y');
    if (steeringPointer !== null) this.releaseCapture(this.surface, steeringPointer);
    for (const name of this.controlNames) {
      const button = this.buttons[name];
      for (const pointer of this.holds[name]) this.releaseCapture(button, pointer);
      this.holds[name].clear();
      button.classList.remove('is-pressed');
      button.setAttribute('aria-pressed', 'false');
    }
  }

  /** Release the input gate after all physical holds are up; false means still held. */
  acknowledgeRelease(): boolean {
    if (!this.allReleased) return false;
    this.releaseGate = false;
    this.blockedKeys.clear();
    this.blockedPointers.clear();
    return true;
  }

  dispose(): void {
    this.clear();
    this.unsubscribeKeys();
    this.abort.abort();
  }

  private beginSteering(event: PointerEvent, app: HTMLElement): void {
    if (!this.active() || this.isInteractiveTarget(event.target)
      || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.isPrimary) this.retireSameTypePointer(event.pointerType);
    if (this.steerPointer !== null || this.physicalPointers.has(event.pointerId)) return;
    event.preventDefault();
    this.physicalPointers.add(event.pointerId);
    this.physicalPointerTypes.set(event.pointerId, event.pointerType);
    if (this.releaseGate || this.blockedPointers.has(event.pointerId)) {
      this.blockedPointers.add(event.pointerId);
      return;
    }
    this.steerPointer = event.pointerId;
    this.steerPointerType = event.pointerType;
    this.origin = { x: event.clientX, y: event.clientY };
    const appRect = app.getBoundingClientRect();
    this.joystick.style.left = `${event.clientX - appRect.left}px`;
    this.joystick.style.top = `${event.clientY - appRect.top}px`;
    this.joystick.classList.add('visible');
    this.joystick.style.setProperty('--joystick-x', '0px');
    this.joystick.style.setProperty('--joystick-y', '0px');
    this.capture(this.surface, event.pointerId);
  }

  private moveSteering(event: PointerEvent): void {
    if (event.pointerId !== this.steerPointer) return;
    if (event.pointerType === 'mouse' && event.buttons === 0) { this.endSteering(event); return; }
    event.preventDefault();
    const dx = event.clientX - this.origin.x;
    const dy = event.clientY - this.origin.y;
    const distance = Math.hypot(dx, dy);
    const radius = 36;
    const scale = distance > radius ? radius / distance : 1;
    const magnitude = Math.min(distance / radius, 1);
    const response = magnitude <= 0.08 ? 0 : (magnitude - 0.08) / 0.92;
    const previousTurn = this.turn;
    const previousClimb = this.climb;
    this.joystick.style.setProperty('--joystick-x', `${dx * scale}px`);
    this.joystick.style.setProperty('--joystick-y', `${dy * scale}px`);
    this.turn = distance === 0 ? 0 : (dx / distance) * response;
    this.climb = distance === 0 ? 0 : (-dy / distance) * response;
    if (Math.abs(this.turn - previousTurn) > 1e-4 || Math.abs(this.climb - previousClimb) > 1e-4) this.steeringRevision += 1;
  }

  /** Pointer IDs can be recycled; a new primary gesture retires a stale gesture of that type. */
  private retireSameTypePointer(pointerType: string): void {
    // Pointer IDs can be recycled after a missed up/cancel. The browser marks a
    // new primary pointer only after the prior primary of that type has ended,
    // so retire stale physical ownership as well as current logical ownership.
    for (const [id, type] of [...this.physicalPointerTypes]) {
      if (type !== pointerType) continue;
      if (this.steerPointer === id) this.endSteering({ pointerId: id } as PointerEvent);
      for (const name of this.controlNames) {
        if (this.holds[name].has(id)) this.endButton(name, this.buttons[name], { pointerId: id } as PointerEvent, false);
      }
      this.physicalPointers.delete(id);
      this.physicalPointerTypes.delete(id);
      this.blockedPointers.delete(id);
      this.releaseCapture(this.surface, id);
      for (const name of this.controlNames) this.releaseCapture(this.buttons[name], id);
    }
  }

  private beginButton(name: FlightControlName, button: HTMLButtonElement, event: PointerEvent): void {
    if (!this.active() || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (this.currentMode === 'easy' && name !== 'loop') return;
    if (event.isPrimary) this.retireSameTypePointer(event.pointerType);
    if (this.physicalPointers.has(event.pointerId)) return;
    event.preventDefault();
    this.physicalPointers.add(event.pointerId);
    this.physicalPointerTypes.set(event.pointerId, event.pointerType);
    if (this.releaseGate || this.blockedPointers.has(event.pointerId)) {
      this.blockedPointers.add(event.pointerId);
      return;
    }
    this.holds[name].add(event.pointerId);
    this.buttonPointerTypes.set(event.pointerId, event.pointerType);
    this.capture(button, event.pointerId);
    button.classList.add('is-pressed');
    button.setAttribute('aria-pressed', 'true');
  }

  private endPointer(event: PointerEvent, completed: boolean): void {
    this.physicalPointers.delete(event.pointerId);
    this.physicalPointerTypes.delete(event.pointerId);
    this.blockedPointers.delete(event.pointerId);
    this.endSteering(event);
    for (const name of this.controlNames) this.endButton(name, this.buttons[name], event, completed);
  }

  private endSteering(event: PointerEvent): void {
    if (event.pointerId !== this.steerPointer) return;
    this.steerPointer = null;
    this.steerPointerType = null;
    if (Math.abs(this.turn) > 1e-4 || Math.abs(this.climb) > 1e-4) this.steeringRevision += 1;
    this.turn = 0;
    this.climb = 0;
    this.joystick.classList.remove('visible');
    this.joystick.style.removeProperty('--joystick-x');
    this.joystick.style.removeProperty('--joystick-y');
  }

  private loseSteeringCapture(event: PointerEvent): void {
    // A normal pointerup releases capture after endPointer() has already ended
    // this steering hold. Capture loss is meaningful only while we still own it.
    if (event.pointerId !== this.steerPointer) return;
    this.blockedPointers.add(event.pointerId);
    this.releaseGate = true;
    this.endSteering(event);
  }

  private endButton(name: FlightControlName, button: HTMLButtonElement, event: PointerEvent, completed: boolean): void {
    if (!this.holds[name].has(event.pointerId)) return;
    this.holds[name].delete(event.pointerId);
    this.buttonPointerTypes.delete(event.pointerId);
    if (completed && this.active() && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && !this.releaseGate) {
      if (name === 'loop') this.loopEdge = true;
    }
    if (this.holds[name].size === 0) {
      button.classList.remove('is-pressed');
      button.setAttribute('aria-pressed', 'false');
    }
  }

  /** Capture loss ends the logical action but does not count as a physical lift. */
  private loseButtonCapture(name: FlightControlName, button: HTMLButtonElement, event: PointerEvent): void {
    // Native pointerup ends the hold before the browser dispatches its implicit
    // lostpointercapture. Do not let that trailing event gate other live inputs.
    if (!this.holds[name].has(event.pointerId)) return;
    this.blockedPointers.add(event.pointerId);
    this.releaseGate = true;
    this.endButton(name, button, event, false);
  }

  private activateOnce(name: FlightControlName): void {
    if (this.releaseGate || this.currentMode === 'easy' && name !== 'loop') return;
    if (name === 'loop') this.loopEdge = true;
    else this.clickBursts.add(name);
  }

  private keyDown(event: KeyboardEvent): void {
    // Browser shortcuts must never leave steering held.
    if (keyboardEventHasShortcutModifier(event)) {
      this.clearKeyboardHolds();
      return;
    }
    const action = this.keyboard.action(event.code);
    if (!action || event.isComposing || this.isInteractiveTarget(event.target)) return;
    if (event.repeat || this.physicalKeys.has(event.code)) return;
    this.physicalKeys.add(event.code);
    // Pause is handled by the screen controller, but its physical hold still
    // participates in the release latch so it cannot leak into a new mission.
    if (action === 'pause') return;
    if (!this.active() || this.currentMode === 'easy' && NORMAL_ONLY_ACTIONS.has(action)) return;
    if (this.releaseGate || this.blockedKeys.has(event.code)) {
      this.blockedKeys.add(event.code);
      return;
    }
    if (STEERING_ACTIONS.has(action)) this.steeringRevision += 1;
    this.keys.add(event.code);
    if (action === 'loop') this.loopEdge = true;
  }

  private keyUp(event: KeyboardEvent): void {
    this.physicalKeys.delete(event.code);
    this.blockedKeys.delete(event.code);
    const wasDown = this.keys.delete(event.code);
    const action = this.keyboard.action(event.code);
    if (wasDown && action && STEERING_ACTIONS.has(action)) this.steeringRevision += 1;
  }

  private clearKeyboardHolds(): void {
    for (const code of this.keys) {
      const action = this.keyboard.action(code);
      if (action && STEERING_ACTIONS.has(action)) this.steeringRevision += 1;
    }
    for (const code of this.physicalKeys) this.blockedKeys.add(code);
    this.keys.clear();
    this.loopEdge = false;
    this.clickBursts.clear();
    this.releaseGate = true;
  }

  private isInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest(INTERACTIVE_TARGETS));
  }

  private capture(element: HTMLElement, pointer: number): void {
    try { element.setPointerCapture(pointer); } catch { /* The pointer may already have been released. */ }
  }

  private releaseCapture(element: HTMLElement, pointer: number): void {
    try { if (element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer); }
    catch { /* Capture can be lost during a blur or screen transition. */ }
  }
}
