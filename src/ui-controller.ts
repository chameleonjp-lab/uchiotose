import { ControlSettings } from './control-settings';
import { ControlInputPresentation, KeyboardSettings, type ControlEditor } from './keyboard-settings';
import { FlightControls, type FlightControlButtons, type FlightMode } from './input';
import { RulesGuide, type RulesContext } from './rules-guide';
import { containTabFocus } from './dialog-focus';

export type UIPhase = 'home' | 'playing' | 'paused' | 'result' | 'loading';
export type UIMode = FlightMode;

export interface UIControllerOptions {
  phase: () => UIPhase;
  mode: () => UIMode;
  onStart: (mode: UIMode) => void;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onHome: () => void;
  onModeChange: (mode: UIMode) => void;
  onSoundChange: (enabled: boolean) => void;
}

export interface UIController {
  controls: FlightControls;
  keyboard: KeyboardSettings;
  setMode(mode: UIMode): void;
  openSettings(source?: HTMLElement): void;
  openRules(source?: HTMLElement): void;
  dispose(): void;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element #${id}`);
  return element as T;
}

function isMode(value: string): value is UIMode { return value === 'easy' || value === 'normal'; }

function modeFromRadios(): UIMode {
  const selected = document.querySelector<HTMLInputElement>('input[name="game-mode"]:checked');
  return selected && isMode(selected.value) ? selected.value : 'easy';
}

function currentEditor(value: string): ControlEditor { return value === 'touch' ? 'touch' : 'keyboard'; }

/** Binds the Home/Pause/Result flow, modal settings, guide, and player input. */
export function createUIController(options: UIControllerOptions): UIController {
  const app = requiredElement<HTMLElement>('app');
  const pauseScreen = requiredElement<HTMLElement>('pause-screen');
  const buttons: FlightControlButtons = {
    fire: requiredElement<HTMLButtonElement>('touch-fire'),
    loop: requiredElement<HTMLButtonElement>('touch-loop'),
    throttle: requiredElement<HTMLElement>('touch-throttle'),
  };
  const abort = new AbortController();
  const keyboard = new KeyboardSettings();
  const presentation = new ControlInputPresentation();
  const controls = new FlightControls(app, buttons, () => options.phase() === 'playing', keyboard, options.mode());
  const settings = new ControlSettings(buttons, keyboard, presentation, () => controls.clear());
  const guide = new RulesGuide((): RulesContext => {
    const mode = options.mode();
    return { mode, input: currentEditor(presentation.value), keyboardDescription: keyboard.describe(mode) };
  }, () => controls.clear());
  let soundEnabled = false;

  const renderGuides = (mode: UIMode): void => {
    const touch = presentation.value === 'touch';
    requiredElement('input-guide').textContent = touch ? '画面をドラッグして操縦' : 'キーボードで操縦';
    requiredElement('mode-guide').textContent = mode === 'easy'
      ? '補助操縦・自動射撃 · 宙返りで回避'
      : '手動操縦・手動射撃 · 速度レバーで調整・離すと保持';
    const keyboardGuide = requiredElement('keyboard-guide');
    keyboardGuide.hidden = touch;
    keyboardGuide.textContent = touch ? '' : keyboard.describe(mode);
  };
  const unsubscribePresentation = presentation.subscribe(() => renderGuides(options.mode()));
  const unsubscribeKeyboard = keyboard.subscribe(() => renderGuides(options.mode()));

  const setMode = (mode: UIMode): void => {
    if (!isMode(mode)) return;
    app.dataset.mode = mode;
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="game-mode"]')) radio.checked = radio.value === mode;
    controls.setMode(mode);
    settings.setActiveMode(mode);
    renderGuides(mode);
    for (const name of ['fire', 'loop', 'throttle'] as const) {
      buttons[name]!.hidden = mode === 'easy' && name !== 'loop';
      buttons[name]!.setAttribute('aria-hidden', String(buttons[name]!.hidden));
    }
  };

  const openSettings = (source?: HTMLElement): void => {
    const phase = options.phase();
    if (phase !== 'home' && phase !== 'paused' && phase !== 'result') return;
    const trigger = source ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
    settings.open(trigger, options.mode(), phase === 'home' || phase === 'result');
  };

  const openRules = (source?: HTMLElement): void => {
    const phase = options.phase();
    if (phase !== 'home' && phase !== 'paused') return;
    const trigger = source ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    if (trigger) guide.open(trigger);
  };

  const bind = (id: string, listener: (event: MouseEvent) => void): void => {
    requiredElement<HTMLButtonElement>(id).addEventListener('click', listener, { signal: abort.signal });
  };

  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="game-mode"]')) {
    radio.addEventListener('change', () => {
      if (!radio.checked || !isMode(radio.value) || options.phase() !== 'home') return;
      setMode(radio.value);
      options.onModeChange(radio.value);
    }, { signal: abort.signal });
  }
  bind('start', () => {
    const mode = modeFromRadios();
    setMode(mode);
    options.onStart(mode);
  });
  bind('pause-button', () => {
    if (options.phase() !== 'playing') return;
    controls.clear();
    options.onPause();
  });
  bind('resume', () => { if (options.phase() === 'paused') options.onResume(); });
  bind('pause-restart', () => { if (options.phase() === 'paused') options.onRetry(); });
  bind('retry', () => { if (options.phase() === 'result') options.onRetry(); });
  bind('home-return', () => { if (options.phase() === 'paused') options.onHome(); });
  bind('result-home', () => { if (options.phase() === 'result') options.onHome(); });

  for (const id of ['home-settings', 'pause-settings', 'result-settings']) {
    bind(id, event => openSettings(event.currentTarget as HTMLElement));
  }
  for (const id of ['home-rules', 'pause-rules']) bind(id, event => openRules(event.currentTarget as HTMLElement));

  const soundButtons = [
    requiredElement<HTMLButtonElement>('home-sound'),
    requiredElement<HTMLButtonElement>('game-sound'),
  ];
  const renderSound = (): void => {
    for (const button of soundButtons) {
      button.textContent = button.id === 'home-sound'
        ? (soundEnabled ? '音声 ON' : '音声 OFF')
        : (soundEnabled ? '音 ON' : '音 OFF');
      button.setAttribute('aria-pressed', String(soundEnabled));
      button.setAttribute('aria-label', soundEnabled ? '音声をオフにする' : '音声をオンにする');
    }
  };
  renderSound();
  for (const button of soundButtons) {
    button.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      renderSound();
      options.onSoundChange(soundEnabled);
    }, { signal: abort.signal });
  }

  window.addEventListener('keydown', event => {
    const phase = options.phase();
    // The paused screen remains visible above the HUD. Keep its keyboard focus
    // within the pause controls unless a native settings/help dialog owns it.
    if (event.key === 'Tab' && phase === 'paused' && !settings.isOpen && !guide.isOpen) {
      containTabFocus(pauseScreen, event);
      return;
    }
    if (!keyboard.matchesPause(event)) return;
    if (phase === 'playing') {
      event.preventDefault();
      controls.clear();
      options.onPause();
    } else if (phase === 'paused') {
      event.preventDefault();
      controls.clear();
      options.onResume();
    }
    // Home and Result retain ordinary Escape/browser behavior.
  }, { signal: abort.signal });

  setMode(options.mode());

  return {
    controls,
    keyboard,
    setMode,
    openSettings,
    openRules,
    dispose(): void {
      abort.abort();
      unsubscribePresentation();
      unsubscribeKeyboard();
      guide.dispose();
      settings.dispose();
      presentation.dispose();
      controls.dispose();
    },
  };
}
