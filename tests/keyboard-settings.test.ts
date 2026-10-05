import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  DEFAULT_KEY_BINDINGS,
  KEY_ACTIONS,
  KEY_LABELS,
  KEYBOARD_STORAGE_KEY,
  KeyboardSettings,
  captureKey,
  isBindableCode,
  isKeyboardEditingTarget,
  keyConflict,
  keyLabel,
  keyboardEventHasShortcutModifier,
  parseKeyBindings,
  preferredControlEditor,
  validKeyBindings,
} from '../src/keyboard-settings';
import type { KeyAction, KeyBindings } from '../src/keyboard-settings';

const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const previousHTMLElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
afterEach(() => {
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  if (previousHTMLElement) Object.defineProperty(globalThis, 'HTMLElement', previousHTMLElement);
  else Reflect.deleteProperty(globalThis, 'HTMLElement');
});

function keyboardEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    code: 'KeyQ', isComposing: false, repeat: false, ctrlKey: false, altKey: false, metaKey: false,
    ...overrides,
  } as KeyboardEvent;
}

function storage(items: Record<string, string | null>) {
  const reads: string[] = [];
  const values = new Map(Object.entries(items));
  return {
    reads,
    values,
    getItem(key: string) { reads.push(key); return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
  };
}

test('the PC assignment contains exactly nine actions and no payload keys', () => {
  assert.equal(KEY_ACTIONS.length, 9);
  assert.deepEqual(KEY_ACTIONS, ['left', 'right', 'up', 'down', 'fire', 'loop', 'accelerate', 'brake', 'pause']);
  assert.deepEqual(Object.keys(DEFAULT_KEY_BINDINGS), [...KEY_ACTIONS]);
  assert.equal('bomb' in DEFAULT_KEY_BINDINGS, false);
  assert.equal('torpedo' in DEFAULT_KEY_BINDINGS, false);
});

test('default keys preserve arrows, Space, L, W/S and Esc', () => {
  assert.deepEqual(DEFAULT_KEY_BINDINGS, {
    left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown',
    fire: 'Space', loop: 'KeyL', accelerate: 'KeyW', brake: 'KeyS', pause: 'Escape',
  });
});

test('labels cover every action', () => {
  assert.deepEqual(Object.keys(KEY_LABELS), [...KEY_ACTIONS]);
  assert.equal(KEY_LABELS.pause, '一時停止・再開');
  assert.equal(KEY_LABELS.loop, '宙返り');
});

test('keyLabel formats letters, digits, arrows, and keypad keys', () => {
  assert.equal(keyLabel('KeyQ'), 'Q');
  assert.equal(keyLabel('Digit7'), '7');
  assert.equal(keyLabel('ArrowLeft'), '←');
  assert.equal(keyLabel('Numpad3'), 'テンキー 3');
  assert.equal(keyLabel('Escape'), 'Esc');
});

test('bindable codes include common keys and function keys outside reserved browser shortcuts', () => {
  for (const code of ['KeyQ', 'Digit5', 'Numpad8', 'ArrowUp', 'Space', 'F2', 'F9', 'F13', 'F24']) {
    assert.equal(isBindableCode(code), true, code);
  }
});

test('Esc is reserved for pause and cannot be assigned to a flight action', () => {
  assert.equal(isBindableCode('Escape'), false);
  assert.equal(isBindableCode('Escape', 'fire'), false);
  assert.equal(isBindableCode('Escape', 'pause'), true);
});

test('browser navigation and focus keys stay reserved', () => {
  for (const code of ['Tab', 'F1', 'F5', 'F6', 'F10', 'F11', 'F12']) {
    assert.equal(isBindableCode(code, 'left'), false, code);
  }
});

test('invalid and unknown key codes cannot be bound', () => {
  for (const code of [null, 4, '', 'ArrowCenter', 'Keyaa', 'F25', 'ControlLeft']) {
    assert.equal(isBindableCode(code, 'fire'), false, String(code));
  }
});

test('a complete unique binding record is valid', () => {
  assert.equal(validKeyBindings({ ...DEFAULT_KEY_BINDINGS }), true);
});

test('duplicate bindings reject the whole record', () => {
  const duplicate = { ...DEFAULT_KEY_BINDINGS, fire: 'ArrowLeft' };
  assert.equal(validKeyBindings(duplicate), false);
});

test('missing actions and malformed records are rejected', () => {
  const missing = { ...DEFAULT_KEY_BINDINGS } as Partial<KeyBindings>;
  delete missing.loop;
  assert.equal(validKeyBindings(missing), false);
  assert.equal(validKeyBindings(null), false);
  assert.equal(validKeyBindings([]), false);
});

test('parseKeyBindings reads a valid version-one record', () => {
  const bindings = { ...DEFAULT_KEY_BINDINGS, fire: 'KeyQ' };
  const parsed = parseKeyBindings(JSON.stringify({ version: 1, bindings }));
  assert.equal(parsed.fire, 'KeyQ');
  assert.equal(parsed.pause, 'Escape');
});

test('parseKeyBindings falls back for malformed, oversized, future, and duplicate data', () => {
  for (const raw of [
    '{broken',
    'x'.repeat(8193),
    JSON.stringify({ version: 2, bindings: { ...DEFAULT_KEY_BINDINGS } }),
    JSON.stringify({ version: 1, bindings: { ...DEFAULT_KEY_BINDINGS, fire: 'ArrowLeft' } }),
    JSON.stringify({ version: 1, bindings: { left: 'ArrowLeft' } }),
  ]) {
    assert.deepEqual(parseKeyBindings(raw), { ...DEFAULT_KEY_BINDINGS });
  }
});

test('captureKey accepts a normal unmodified key', () => {
  assert.deepEqual(captureKey(keyboardEvent()), { kind: 'key', code: 'KeyQ' });
});

test('captureKey keeps Escape as the capture-cancel action', () => {
  assert.deepEqual(captureKey(keyboardEvent({ code: 'Escape' })), { kind: 'cancel' });
});

test('captureKey ignores composition and repeat events', () => {
  assert.deepEqual(captureKey(keyboardEvent({ isComposing: true })), { kind: 'ignore' });
  assert.deepEqual(captureKey(keyboardEvent({ repeat: true })), { kind: 'ignore' });
});

test('captureKey rejects browser shortcuts and reserved keys', () => {
  assert.equal(captureKey(keyboardEvent({ ctrlKey: true })).kind, 'error');
  assert.equal(captureKey(keyboardEvent({ altKey: true })).kind, 'error');
  assert.equal(captureKey(keyboardEvent({ metaKey: true })).kind, 'error');
  assert.equal(captureKey(keyboardEvent({ code: 'Tab' })).kind, 'error');
  assert.equal(captureKey(keyboardEvent({ code: 'F5' })).kind, 'error');
});

test('keyConflict finds an existing owner without treating the current action as a conflict', () => {
  const bindings = { ...DEFAULT_KEY_BINDINGS };
  assert.equal(keyConflict(bindings, 'fire', 'ArrowLeft'), 'left');
  assert.equal(keyConflict(bindings, 'left', 'ArrowLeft'), undefined);
  assert.equal(keyConflict(bindings, 'fire', 'KeyQ'), undefined);
});

test('shortcut modifiers are detected independently', () => {
  assert.equal(keyboardEventHasShortcutModifier(keyboardEvent({ ctrlKey: true })), true);
  assert.equal(keyboardEventHasShortcutModifier(keyboardEvent({ altKey: true })), true);
  assert.equal(keyboardEventHasShortcutModifier(keyboardEvent({ metaKey: true })), true);
  assert.equal(keyboardEventHasShortcutModifier(keyboardEvent()), false);
});

test('editing targets include text fields, contenteditable, and dialogs', () => {
  const input = documentTarget('input');
  const edit = documentTarget('[contenteditable="true"]');
  const dialog = documentTarget('dialog');
  assert.equal(isKeyboardEditingTarget(input), true);
  assert.equal(isKeyboardEditingTarget(edit), true);
  assert.equal(isKeyboardEditingTarget(dialog), true);
  assert.equal(isKeyboardEditingTarget(null), false);
});

function documentTarget(selector: string): HTMLElement {
  if (typeof globalThis.HTMLElement === 'undefined') {
    class TestHTMLElement {
      isContentEditable = false;
      kind = '';
      closest(query: string): TestHTMLElement | null {
        return query.includes(this.kind) && ['input', 'textarea', 'select', 'dialog'].includes(this.kind)
          ? this : null;
      }
    }
    Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: TestHTMLElement });
  }
  const ElementConstructor = (globalThis as unknown as { HTMLElement: new () => HTMLElement & { kind?: string } }).HTMLElement;
  const element = new ElementConstructor();
  element.kind = selector.includes('contenteditable') ? 'contenteditable' : selector;
  Object.defineProperty(element, 'isContentEditable', { value: selector.includes('contenteditable') });
  return element;
}

test('input editor preference suggests touch on touch-only devices but never restricts an editor', () => {
  assert.equal(preferredControlEditor(false, false, 5), 'touch');
  assert.equal(preferredControlEditor(true, true, 5), 'keyboard');
  assert.equal(preferredControlEditor(false, false, 0), 'keyboard');
  assert.equal(preferredControlEditor(false, false, 5, true), 'keyboard');
});

test('KeyboardSettings reads only the Uchiotose storage key and applies committed bindings', () => {
  const data = storage({ [KEYBOARD_STORAGE_KEY]: JSON.stringify({ version: 1, bindings: DEFAULT_KEY_BINDINGS }), 'kaisen-keyboard-v1': 'untouched' });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: data });
  const settings = new KeyboardSettings();
  assert.deepEqual(data.reads, [KEYBOARD_STORAGE_KEY]);
  assert.equal(settings.code('fire'), 'Space');
  let notifications = 0;
  settings.subscribe(() => { notifications += 1; });
  const changed = { ...DEFAULT_KEY_BINDINGS, fire: 'KeyQ' };
  settings.apply(changed);
  assert.equal(settings.code('fire'), 'KeyQ');
  assert.equal(settings.action('KeyQ'), 'fire');
  assert.equal(notifications, 1);
  assert.equal(data.values.get('kaisen-keyboard-v1'), 'untouched');
});

test('KeyboardSettings refuses invalid live bindings', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage({}) });
  const settings = new KeyboardSettings();
  const invalid = { ...DEFAULT_KEY_BINDINGS, fire: 'ArrowLeft' };
  settings.apply(invalid);
  assert.equal(settings.code('fire'), 'Space');
});

test('matchesPause accepts only the configured unmodified nonrepeat pause key outside editors', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage({}) });
  const settings = new KeyboardSettings();
  const target = documentTarget('button');
  const dialog = documentTarget('dialog');
  assert.equal(settings.matchesPause(keyboardEvent({ code: 'Escape', target })), true);
  assert.equal(settings.matchesPause(keyboardEvent({ code: 'Escape', target: dialog })), false);
  assert.equal(settings.matchesPause(keyboardEvent({ code: 'Escape', repeat: true, target })), false);
  assert.equal(settings.matchesPause(keyboardEvent({ code: 'Escape', altKey: true, target })), false);
  assert.equal(settings.matchesPause(keyboardEvent({ code: 'Escape', isComposing: true, target })), false);
  assert.equal(settings.matchesPause(keyboardEvent({ code: 'Enter', target })), false);
});

test('mode descriptions omit Normal-only actions in Easy and list every action in Normal', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage({}) });
  const settings = new KeyboardSettings();
  const normal = settings.describe('normal');
  const easy = settings.describe('easy');
  assert.match(normal, /Space 射撃/);
  assert.match(normal, /W 加速/);
  assert.match(normal, /S 減速/);
  assert.match(normal, /Esc 一時停止・再開/);
  assert.doesNotMatch(easy, /射撃|加速|減速/);
  assert.match(easy, /宙返り/);
  assert.match(easy, /一時停止・再開/);
});
