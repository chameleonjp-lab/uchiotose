import './style.css';
import './control-settings.css';
import { Vector3, Quaternion } from 'three';
import { createSimulation, stepSimulation, setSimulationPhase, releaseSimulationInput, getSimulationScore } from './simulation';
import type { SimulationState } from './simulation';
import { WorldRenderer } from './world-renderer';
import { createUIController } from './ui-controller';
import { el, text, homeStatus, renderScreen, focusScreen, renderHUD, renderResult, renderFailureStatus, RUNTIME_FAILURE_REASON } from './ui-view';
import { FixedClock } from './fixed-clock';
import { FlightAudio } from './audio';
import type { GameMode, FlightInput } from './flight-types';

const app = el('app'), canvas = el<HTMLCanvasElement>('flight'), markers = el<HTMLCanvasElement>('markers');
const audio = new FlightAudio(), clock = new FixedClock();
let mode: GameMode = 'easy', generation = 0;
let state = createSimulation({missionId: 'home-0', seed: 20261005, mode, phase: 'home'});
let lastHudState: SimulationState | null = null, lastHudMode: GameMode | null = null;
let renderer: WorldRenderer | null = null, contextLost = false, ready = false, disposed = false, faulted = false;
let frameId = 0, controlResetVersion = -1, eventId = 0;
let pendingLoop = false, renderedResultId: string | null = null;
const frameTimes: number[] = [];
let previousFrame = 0;
const ui = createUIController({
  phase: () => state.mission.phase,
  mode: () => mode,
  onStart: selected => { mode = selected; start(); },
  onPause: () => pause('タイムの計測も止まっています'),
  onResume: resume,
  onRetry: start,
  onHome: home,
  onModeChange: selected => { mode = selected; ui.setMode(mode); app.dataset.mode = mode; },
  onSoundChange: enabled => { audio.enabled = enabled; syncAudio(); if (enabled) void audio.unlock().then(syncAudio); },
});
function syncAudio(): void {
  audio.active = state.mission.phase === 'playing' && Boolean(state.mission.controlledAircraftId) && !document.hidden && !contextLost;
  audio.sync();
}
function screen(): void {
  const phase = state.mission.phase;
  renderScreen({phase, mode, ready, faulted, contextLost});
  ui.controls.clear(); clock.reset(); pendingLoop = false;
  if (phase === 'result') audio.finishFlight(); else syncAudio();
  focusScreen(phase);
}

function start(): void {
  if (!ready || contextLost) return;
  state = createSimulation({missionId: `mission-${++generation}`, seed: 20261005, mode, phase: 'playing'});
  controlResetVersion = -1; faulted = false;
  el<HTMLButtonElement>('resume').disabled = false;
  ui.setMode(mode); renderer?.resetCamera(); audio.resetFlight(); screen(); updateHUD();
  void audio.unlock().then(syncAudio);
}
function pause(reason: string): void {
  if (state.mission.phase !== 'playing') return;
  state = setSimulationPhase(state, 'paused');
  text('pause-reason', reason); screen(); updateHUD();
}
function resume(): void {
  if (state.mission.phase !== 'paused' || contextLost || faulted || document.hidden) return;
  state = setSimulationPhase(state, 'playing'); screen();
  void audio.unlock().then(syncAudio);
}
function home(): void {
  state = createSimulation({missionId: `home-${++generation}`, seed: 20261005, mode, phase: 'home'});
  audio.resetFlight(); renderer?.resetCamera(); screen();
}
function updateHUD(): void {
  // Simulation is immutable: paused/Home frames can reuse the same HUD without
  // mutating text nodes beneath modal backdrop compositing on every rAF.
  if (lastHudState === state && lastHudMode === mode) return;
  lastHudState = state; lastHudMode = mode;
  renderHUD(state, mode);
  updateScore();
}
function updateScore(): void {
  const breakdown = state.result?.breakdown ?? getSimulationScore(state);
  text('hud-score', `${breakdown.total.toLocaleString('ja-JP')}点`);
  if (!state.result) return;
  const result = state.result;
  if (renderedResultId === result.missionId) return;
  renderedResultId = result.missionId;
  renderResult(result, breakdown, mode);
}
function soundChanges(before: SimulationState): void {
  const id = state.mission.controlledAircraftId;
  const player = state.mission.aircraft.find(item => item.id === id);
  const old = before.mission.aircraft.find(item => item.id === id);
  const position = player ? state.world.aircraft[player.id]?.position : null;
  const soundEvent = (type: 'shot'|'damage'|'kill'|'loop', playerEvent = true) => audio.event({id: ++eventId, type, owner: 1, position: new Vector3(position?.x ?? 0,position?.y ?? 0,position?.z ?? 0)}, playerEvent);
  if (player && old) {
    if (player.machineGunAmmo < old.machineGunAmmo || player.cannonAmmo < old.cannonAmmo) soundEvent('shot');
    if (player.hp < old.hp) soundEvent('damage');
    if (player.burns.length > old.burns.length) audio.status('fire');
    if (player.ice && (!old.ice || player.ice.expiresAtTick !== old.ice.expiresAtTick)) audio.status('ice');
    if (player.reloadUntilTick !== old.reloadUntilTick) audio.status('reload');
    if (player.loopActive && !old.loopActive) soundEvent('loop');
  }
  if (state.mission.losses.player > before.mission.losses.player) soundEvent('kill', false);
  else if (state.mission.losses.enemies > before.mission.losses.enemies) soundEvent('kill');
  if (id !== before.mission.controlledAircraftId) {
    if (!id) audio.finishFlight();
    else { syncAudio(); audio.status('respawn'); }
  }
  if (player) {
    const pose = state.world.aircraft[player.id];
    const listener = {id: Number(player.id.slice(1)), position: new Vector3(pose.position.x,pose.position.y,pose.position.z),
      quaternion: new Quaternion(pose.quaternion.x,pose.quaternion.y,pose.quaternion.z,pose.quaternion.w), health: player.hp, speed: player.actualSpeedMps, age: state.mission.tick/60};
    for (const event of state.events) {
      if (event.type === 'shot' && event.kind === 'anti-air') {
        audio.worldEvent({id: ++eventId, type:'shot', owner:Number(event.ownerId?.slice(1) ?? 0),tick:state.mission.tick,
          position:new Vector3(event.position.x,event.position.y,event.position.z)},listener,'naval-shot');
      } else if (event.type === 'shot' && (event.kind === 'fire' || event.kind === 'ice') &&
        listener.position.distanceTo(new Vector3(event.position.x,event.position.y,event.position.z)) < 1200) audio.status(event.kind);
    }
  }
}
function step(input: FlightInput): boolean {
  if (controlResetVersion !== state.mission.controlResetVersion) {
    controlResetVersion = state.mission.controlResetVersion;
    ui.controls.clear(); renderer?.resetCamera(); pendingLoop = false;
    input = {turn: 0, climb: 0, fire: false, loop: false, throttle: 0, accelerate: false, brake: false};
  }
  if (ui.controls.allReleased) {
    ui.controls.acknowledgeRelease(); state = releaseSimulationInput(state);
  }
  const before = state;
  state = stepSimulation(state, {...input, viewAspect: Math.max(.1, canvas.clientWidth / Math.max(1,canvas.clientHeight))}, mode);
  soundChanges(before);
  if (state.mission.phase === 'result') { screen(); updateHUD(); return false; }
  return true;
}
function frame(now: number): void {
  if (disposed) return;
  frameId = requestAnimationFrame(frame);
  if (previousFrame && state.mission.phase === 'playing') {
    frameTimes.push(now - previousFrame); if (frameTimes.length > 36000) frameTimes.shift();
  }
  previousFrame = now;
  const input = ui.controls.sample(false);
  pendingLoop ||= input.loop;
  if (faulted) return;
  try {
    const overload = clock.frame(now, state.mission.phase === 'playing', () => {
      const accepted = {...input, throttle: ui.controls.sampleThrottle(), loop: pendingLoop}; pendingLoop = false; return step(accepted);
    });
    if (overload) pause('処理負荷が高いため停止しました。再開すると未処理時間を追いかけずに続行します');
    if (renderer && !contextLost) renderer.render(state.world, state.mission, state.projectiles, mode, state.mission.phase === 'playing' ? clock.interpolation : 1);
    updateHUD();
    const player = state.mission.aircraft.find(item => item.id === state.mission.controlledAircraftId);
    if (player) audio.update(player.actualSpeedMps);
  } catch (error) {
    if (renderer?.renderer.getContext().isContextLost()) {
      contextLost = true;
      homeStatus('描画が中断されました。復旧を待ってください');
      pause('描画が中断されました。復旧を待って再開してください');
      text('pause-reason','描画が中断されました。復旧を待って再開してください');
      screen();
      return;
    }
    faulted = true; ready = false;
    el<HTMLButtonElement>('start').disabled = true;
    pause(RUNTIME_FAILURE_REASON);
    screen();
    renderFailureStatus('runtime', state.mission.phase);
    console.error(error);
  }
}
const abort = new AbortController(), options = {signal: abort.signal};
window.addEventListener('blur', () => pause('画面の操作が中断されたため停止しました'), options);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause('別の画面へ移動したため停止しました'); }, options);
window.addEventListener('resize', () => { ui.controls.clear(); renderer?.resize(); }, options);
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault(); contextLost = true; el<HTMLButtonElement>('resume').disabled = true; pause('描画が中断されました。復旧を待って再開してください');
  el<HTMLButtonElement>('start').disabled = true;
  homeStatus('描画が中断されました。復旧を待ってください');
  text('pause-reason','描画が中断されました。復旧を待って再開してください');
  screen();
}, options);
/** A recovery frame is prepared while the mission remains paused. */
function waitForPreparedFrame(target: WorldRenderer): Promise<void> {
  return new Promise((resolve, reject) => {
    const begun = performance.now();
    const check = (): void => {
      if (disposed) { reject(new Error('Disposed during recovery')); return; }
      const status = target.pollRender();
      if (status === 'ready') { resolve(); return; }
      if (status === 'failed' || performance.now() - begun > 30000) { reject(new Error(`Recovery GPU frame ${status}`)); return; }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}
let recoveryGeneration = 0;
canvas.addEventListener('webglcontextrestored', () => {
  // Three's own listener was registered after ours; let its restore finish first.
  queueMicrotask(() => {
    if (!renderer || disposed || faulted) return;
    const target = renderer;
    const generation = ++recoveryGeneration;
    const current = (): boolean => !disposed && !faulted && generation === recoveryGeneration;
    const fail = (error: unknown): void => {
      if (!current()) return;
      ++recoveryGeneration; faulted = true; ready = false; screen();
      text('pause-reason','描画を復旧できません。ページを再読み込みしてください');
      homeStatus('描画を復旧できません。ページを再読み込みしてください');
      console.error(error);
    };
    const recoveryTimeout = setTimeout(() => fail(new Error('Graphics recovery timed out')), 30000);
    target.resetRenderQueue(); target.resize(); target.resetCamera();
    text('pause-reason','描画の復旧を準備しています');
    homeStatus('描画の復旧を準備しています');
    void target.prepare().then(async () => {
      if (!current()) return;
      target.render(state.world, state.mission, state.projectiles, mode, 1);
      await waitForPreparedFrame(target);
      if (!current()) return;
      clearTimeout(recoveryTimeout);
      contextLost = false;
      homeStatus('準備完了 · 操作設定とルールを確認して出撃できます', true);
      el<HTMLButtonElement>('start').disabled = !ready;
      screen();
      text('pause-reason','描画が復旧しました。再開できます');
    }).catch(error => { clearTimeout(recoveryTimeout); fail(error); });
  });
}, options);

function dispose(): void {
  if (disposed) return; disposed = true;
  cancelAnimationFrame(frameId); abort.abort(); ui.dispose(); audio.dispose(); renderer?.dispose();
}
window.addEventListener('pagehide', event => {
  if (event.persisted) pause('ページの移動により停止しました'); else dispose();
}, options);
if (import.meta.env.DEV) {
  Object.defineProperty(window, '__uchiotose', {value: {
    snapshot: () => structuredClone(state),
    diagnostics: () => ({renderer: renderer?.diagnostics(), audio: {enabled:audio.enabled, active:audio.active, voices:audio.activeEffectVoiceCount,sources:audio.activeEffectSourceCount}, frameTimes: [...frameTimes]}),
    // Explicit test fixture entry; production builds contain no state manipulation API.
    setStateForTest: (candidate: SimulationState) => { state = candidate; mode = candidate.mode; ui.setMode(mode); lastHudState = null; renderedResultId = null; controlResetVersion = -1; renderer?.resetCamera(); screen(); updateHUD(); },
    advanceForTest: (ticks: number, input: FlightInput) => {
      for (let i=0;i<ticks && state.mission.phase === 'playing';i++) state=stepSimulation(state,input,mode);
      screen(); updateHUD();
    },
  }});
}
function preparationFailed(error: unknown): void {
  ready = false; faulted = true;
  el<HTMLButtonElement>('start').disabled = true;
  renderFailureStatus('prepare', state.mission.phase);
  console.error(error);
}
try {
  renderer = new WorldRenderer(canvas, markers);
  const preparationTimeout = setTimeout(() => {
    if (!ready && !disposed) preparationFailed(new Error('Graphics preparation timed out'));
  }, 30000);
  void renderer.prepare().then(() => {
    if (disposed || faulted || !renderer) return;
    renderer.render(state.world, state.mission, [], mode, 1);
    const checkPreparation = (): void => {
      if (disposed || faulted || !renderer) { clearTimeout(preparationTimeout); return; }
      const status = renderer.pollRender();
      if (status === 'pending') { frameId = requestAnimationFrame(checkPreparation); return; }
      clearTimeout(preparationTimeout);
      if (status !== 'ready' || contextLost) { preparationFailed(new Error(`Graphics preparation ${status}`)); return; }
      ready = true;
      el<HTMLButtonElement>('start').disabled = false;
      homeStatus('準備完了 · 操作設定とルールを確認して出撃できます', true);
      screen(); frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(checkPreparation);
  }).catch(error => { clearTimeout(preparationTimeout); if (!disposed) preparationFailed(error); });
} catch (error) { preparationFailed(error); }
