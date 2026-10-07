import { readSettingsValue } from './settings-storage';
/* Adapted from kaisen-reference/src/keyboard-settings.ts at 3d751051dc6212482a129e8da596ddd349b2f9f5. */
export const KEYBOARD_STORAGE_KEY = 'uchiotose-keyboard-v1';

/** Four steering keys, three Normal-only holds, one loop, and pause. */
export const KEY_ACTIONS = [
  'left', 'right', 'up', 'down', 'fire', 'loop', 'accelerate', 'brake', 'pause',
] as const;
export type KeyAction = typeof KEY_ACTIONS[number];
export type KeyBindings = Record<KeyAction, string>;
export type ControlEditor = 'touch' | 'keyboard';

export const KEY_LABELS: Record<KeyAction, string> = {
  left: '左旋回', right: '右旋回', up: '上昇', down: '下降', fire: '射撃', loop: '宙返り',
  accelerate: '加速', brake: '減速', pause: '一時停止・再開',
};

export const DEFAULT_KEY_BINDINGS: Readonly<KeyBindings> = Object.freeze({
  left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', fire: 'Space',
  loop: 'KeyL', accelerate: 'KeyW', brake: 'KeyS', pause: 'Escape',
});

const NAMED_KEYS: Record<string, string> = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Escape: 'Esc',
  Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'Page Up', PageDown: 'Page Down', ShiftLeft: '左 Shift', ShiftRight: '右 Shift',
  Minus: '−', Equal: '= / ^', BracketLeft: '[ / @', BracketRight: '] / [', Backslash: '\\ / ]',
  Semicolon: ';', Quote: "' / :", Backquote: '` / 半角', Comma: ',', Period: '.', Slash: '/',
  IntlBackslash: 'Intl \\', IntlRo: 'ろ / \\', IntlYen: '¥ / \\',
  NumpadAdd: 'テンキー +', NumpadSubtract: 'テンキー −', NumpadMultiply: 'テンキー ×',
  NumpadDivide: 'テンキー ÷', NumpadDecimal: 'テンキー .', NumpadEnter: 'テンキー Enter', NumpadEqual: 'テンキー =',
};

// Preserve browser navigation, developer tools, and focus traversal.
const RESERVED_KEYS = new Set(['Tab', 'F1', 'F5', 'F6', 'F10', 'F11', 'F12']);
const NORMAL_ONLY_ACTIONS = new Set<KeyAction>(['fire', 'accelerate', 'brake']);

export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `テンキー ${code.slice(6)}`;
  return NAMED_KEYS[code] ?? code;
}

export function isBindableCode(code: unknown, action?: KeyAction): code is string {
  if (typeof code !== 'string' || RESERVED_KEYS.has(code)) return false;
  if (code === 'Escape') return action === 'pause';
  return Object.hasOwn(NAMED_KEYS, code) || /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([2-9]|1[3-9]|2[0-4]))$/.test(code);
}

/** Reject a malformed record in full so defaults can never introduce key conflicts. */
export function validKeyBindings(value: unknown): value is KeyBindings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const bindings = value as Record<string, unknown>;
  return KEY_ACTIONS.every(action => isBindableCode(bindings[action], action))
    && new Set(KEY_ACTIONS.map(action => bindings[action])).size === KEY_ACTIONS.length;
}

export function parseKeyBindings(raw: string | null): KeyBindings {
  try {
    if (raw && raw.length > 8192) return { ...DEFAULT_KEY_BINDINGS };
    const data: unknown = raw ? JSON.parse(raw) : null;
    if (data && typeof data === 'object' && 'version' in data && data.version === 1
      && 'bindings' in data) {
      const bindings = data.bindings;
      if (validKeyBindings(bindings)) {
        return Object.fromEntries(KEY_ACTIONS.map(action => [action, bindings[action]])) as KeyBindings;
      }
    }
  } catch { /* Invalid data safely falls back without being rewritten on load. */ }
  return { ...DEFAULT_KEY_BINDINGS };
}

export function keyboardEventHasShortcutModifier(event: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'metaKey'>): boolean {
  return Boolean(event.ctrlKey || event.altKey || event.metaKey);
}

export function isKeyboardEditingTarget(target: EventTarget | null): boolean {
  return typeof HTMLElement !== 'undefined' && target instanceof HTMLElement
    && (target.isContentEditable || Boolean(target.closest('input, textarea, select, dialog')));
}

export type CaptureResult =
  | { kind: 'ignore' }
  | { kind: 'cancel' }
  | { kind: 'error'; message: string }
  | { kind: 'key'; code: string };

export function captureKey(event: KeyboardEvent): CaptureResult {
  if (event.isComposing || event.repeat) return { kind: 'ignore' };
  if (keyboardEventHasShortcutModifier(event)) {
    return { kind: 'error', message: 'Ctrl・Alt・⌘との組み合わせはブラウザ操作用です。別のキーを押してください。' };
  }
  if (event.code === 'Escape') return { kind: 'cancel' };
  if (!isBindableCode(event.code)) {
    return { kind: 'error', message: 'このキーはブラウザや文字入力で使います。文字・数字・矢印など、別のキーを押してください。' };
  }
  return { kind: 'key', code: event.code };
}

export function keyConflict(bindings: KeyBindings, action: KeyAction, code: string): KeyAction | undefined {
  return KEY_ACTIONS.find(other => other !== action && bindings[other] === code);
}

/** Input type is a preference only; hybrids may always open either editor. */
export function preferredControlEditor(finePointer: boolean, hover: boolean, touchPoints: number, keyboardSeen = false): ControlEditor {
  return keyboardSeen || (finePointer && hover) || touchPoints === 0 ? 'keyboard' : 'touch';
}

export function preferredControlInput(): ControlEditor {
  return preferredControlEditor(
    window.matchMedia?.('(any-pointer: fine)').matches ?? false,
    window.matchMedia?.('(any-hover: hover)').matches ?? false,
    navigator.maxTouchPoints ?? 0,
  );
}

/** Tracks recent input only to select the first settings editor; it never hides either editor. */
export class ControlInputPresentation {
  private current = preferredControlInput();
  private pendingPointer: string | null = null;
  private readonly abort = new AbortController();
  private readonly listeners = new Set<() => void>();

  constructor() {
    window.addEventListener('pointerdown', event => { this.pendingPointer = event.pointerType; }, { signal: this.abort.signal });
    window.addEventListener('pointercancel', () => { this.pendingPointer = null; }, { signal: this.abort.signal });
    window.addEventListener('blur', () => { this.pendingPointer = null; }, { signal: this.abort.signal });
    window.addEventListener('click', event => {
      const pointer = this.pendingPointer || event.pointerType;
      this.pendingPointer = null;
      if (pointer === 'mouse') this.set('keyboard');
      else if (pointer === 'touch' || pointer === 'pen') this.set('touch');
    }, { signal: this.abort.signal, capture: true });
    window.addEventListener('keydown', event => {
      this.pendingPointer = null;
      if (!event.isComposing && !keyboardEventHasShortcutModifier(event)) this.set('keyboard');
    }, { signal: this.abort.signal });
  }

  get value(): ControlEditor { return this.current; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispose(): void { this.abort.abort(); this.listeners.clear(); }

  private set(value: ControlEditor): void {
    if (this.current === value) return;
    this.current = value;
    for (const listener of this.listeners) listener();
  }
}

/** Settings owns persistence; flight receives committed bindings only. */
export class KeyboardSettings {
  private current: KeyBindings;
  private readonly listeners = new Set<() => void>();

  constructor() {
    let raw: string | null = null;
    try { raw = readSettingsValue(KEYBOARD_STORAGE_KEY, localStorage); } catch { /* Storage is optional. */ }
    this.current = parseKeyBindings(raw);
  }

  get bindings(): KeyBindings { return { ...this.current }; }
  code(action: KeyAction): string { return this.current[action]; }
  action(code: string): KeyAction | undefined { return KEY_ACTIONS.find(action => this.current[action] === code); }

  apply(bindings: KeyBindings): void {
    if (!validKeyBindings(bindings)) return;
    this.current = { ...bindings };
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  matchesPause(event: KeyboardEvent): boolean {
    return event.code === this.current.pause && !event.repeat && !event.isComposing
      && !keyboardEventHasShortcutModifier(event) && !isKeyboardEditingTarget(event.target);
  }

  describe(mode: 'normal' | 'easy'): string {
    const actions = KEY_ACTIONS.filter(action => mode === 'normal' || !NORMAL_ONLY_ACTIONS.has(action));
    return `キーボード：${actions.map(action => `${keyLabel(this.current[action])} ${KEY_LABELS[action]}`).join(' ・ ')}`;
  }
}
