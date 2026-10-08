import '../src/style.css';
import '../src/control-settings.css';
import { createUIController, type UIPhase } from '../src/ui-controller';
import { el, text, homeStatus, renderScreen, focusScreen, renderHUD, renderResult, renderFailureStatus } from '../src/ui-view';
import { createMissionState } from '../src/roster';
import { createWorldState } from '../src/world';
import { PerspectiveCamera, Vector3 } from 'three';
import { projectGunSight } from '../src/gun-sight';
import { FLIGHT_FOV, getFlightCameraPose } from '../src/flight-view';
import { drawHUDOverlay } from '../src/hud-overlay';
import type { GameMode } from '../src/flight-types';
import type { ResultSnapshot, ScoreBreakdown } from '../src/scoring';

// This entry is served ONLY by vite.ui-only.config.ts. The production HTML,
// CSS, controller, dialogs and presentation functions are reused unchanged.
// No renderer, audio, simulation import, rAF loop, combat or physics tick.
if (!import.meta.env.DEV || import.meta.env.MODE !== 'ui-only') throw new Error('UI fixture requires the dedicated local test server');
const loadingMessage = el('p1-status').textContent!;
let errorKind: 'prepare' | 'runtime' = 'prepare';
let phase: UIPhase = 'home', mode: GameMode = 'easy', failed = false;
let resultOutcome: 'victory' | 'defeat' = 'victory';
let canvasRegions: Record<string, {x:number;y:number;width:number;height:number}> = {};
const ui = createUIController({
  phase: () => phase, mode: () => mode,
  onStart: selected => show('playing', selected),
  onPause: () => show('paused'), onResume: () => show('playing'),
  onRetry: () => show('playing'), onHome: () => { if (failed) showError('home', errorKind); else show('home'); },
  onModeChange: selected => { mode = selected; }, onSoundChange: () => {},
});
const breakdown: ScoreBreakdown = {
  kills: 100, playerDamage: 1250.25, killPoints: 10000, damagePoints: 6251.25,
  timeBonus: 750, playerLossPenalty: -500, wingLossPenalty: -400,
  shipLossPenalty: -1000, rawTotal: 15101.25, total: 15101,
};
function show(next: UIPhase, selected: GameMode = mode, outcome: 'victory' | 'defeat' = 'victory'): void {
  phase = next; mode = selected; resultOutcome = outcome; failed = false;
  ui.setMode(mode);
  renderScreen({phase, mode, ready: true, faulted: false, contextLost: false});
  const mission = createMissionState({missionId: 'ui-display-only', seed: 1, phase: 'playing'});
  mission.phase = phase;
  // Values are display samples, not results of a played or simulated mission.
  mission.tick = 123 * 60;
  const world = createWorldState(mission);
  // Representative display data only: a visible enemy, friendly and ship,
  // one off-screen enemy, plus the product reload arc. Nothing is fired or hit.
  const player = world.aircraft[mission.controlledAircraftId!];
  player.position = {x: 4000, y: 1000, z: 0};
  player.quaternion = {x: 0, y: 0, z: 0, w: 1}; player.bank = 0; player.yaw = 0;
  for (const [id, body] of Object.entries(world.aircraft)) if (id !== player.id) body.position = {x: 4000, y: 1000, z: 4000};
  for (const body of Object.values(world.enemies)) body.position = {x: 4000, y: 1000, z: 4000};
  for (const body of Object.values(world.ships)) body.position = {x: 12000, y: 0, z: 0};
  world.aircraft.A002.position = {x: 3800, y: 1000, z: -800};
  world.enemies.E001.position = {x: 4000, y: 1000, z: -500};
  world.enemies.E002.position = {x: 4500, y: 1000, z: 100};
  world.ships.S001.position = {x: 4295, y: 940, z: -900};
  mission.aircraft[0].reloadUntilTick = mission.tick + 180;
  renderHUD({mission, world}, mode);
  const canvas = el<HTMLCanvasElement>('markers');
  canvas.width = innerWidth; canvas.height = innerHeight;
  const camera = new PerspectiveCamera(FLIGHT_FOV, innerWidth / innerHeight, .5, 22000);
  if (player) {
    const pose = getFlightCameraPose(player, mode);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
    camera.updateMatrixWorld();
  }
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D UI canvas unavailable');
  drawHUDOverlay(context, innerWidth, innerHeight, world, mission, mode, player, camera);
  const sight = mode === 'normal' ? projectGunSight(player, innerWidth, innerHeight) : {x:innerWidth/2,y:innerHeight/2};
  const region = (position: {x:number;y:number;z:number}, width: number, height: number, verticalOffset = 10) => {
    const projected = new Vector3(position.x,position.y,position.z).project(camera);
    return {x:(projected.x*.5+.5)*innerWidth-width/2,y:(.5-projected.y*.5)*innerHeight-verticalOffset-height/2,width,height};
  };
  const radius = mode === 'normal' ? Math.max(26,Math.min(38,Math.min(innerWidth,innerHeight)*.085)) : Math.min(innerWidth,innerHeight)*.135;
  canvasRegions = {
    sight: {x:sight.x-radius-10,y:sight.y-radius-10,width:radius*2+20,height:radius*2+20},
    enemy: region(world.enemies.E001.position,44,42),
    friendly: region(world.aircraft.A002.position,14,20,0),
    ship: region({...world.ships.S001.position,y:960},24,20,0),
    offscreen: {x:innerWidth-42,y:innerHeight/2-24,width:40,height:48},
  };
  text('hud-score', '15,101点');
  if (phase === 'result') {
    const result: ResultSnapshot = {
      missionId: 'ui-result-display-only', rulesVersion: 'ui-display-sample', mode,
      outcome, reason: outcome === 'victory' ? 'all-enemies-defeated' : 'fleet-destroyed',
      tick: 7380, elapsedSeconds: 123, losses: {player: 1, wing: 2, ships: 1, enemies: 100},
      breakdown, score: breakdown.total,
    };
    renderResult(result, breakdown, mode);
  }
  text('pause-reason', 'タイムの計測も止まっています');
  homeStatus('準備完了 · 操作設定とルールを確認して出撃できます', true);
  ui.controls.clear(); focusScreen(phase);
}
function showError(next: 'home' | 'paused' | 'result', kind: 'prepare' | 'runtime' = next === 'home' ? 'prepare' : 'runtime'): void {
  show(next); failed = true; errorKind = kind;
  renderScreen({phase, mode, ready: false, faulted: true, contextLost: false});
  renderFailureStatus(kind, phase);
  focusScreen(phase);
}
Object.defineProperty(window, '__uiOnly', {value: {
  show, showError,
  showLoading: () => {
    show('home');
    renderScreen({phase:'home',mode,ready:false,faulted:false,contextLost:false});
    homeStatus(loadingMessage);
  },
  canvasRegions: () => canvasRegions,
  showHUDState: (variant: 'effects' | 'warning' | 'respawn') => {
    show('playing', 'normal');
    const mission = createMissionState({missionId:'ui-status-display-only',seed:1,phase:'playing'});
    mission.tick = 60;
    const world = {aircraft:{A001:{position:{x:4000,y:1000,z:0}}}};
    if (variant === 'effects') {
      mission.aircraft[0].burns = [{projectileId:'ui-fire',startsAtSeconds:0,endsAtSeconds:4}];
      mission.aircraft[0].ice = {startsAtTick:0,expiresAtTick:300};
    } else if (variant === 'warning') world.aircraft.A001.position.y = 100;
    else mission.controlledAircraftId = null;
    renderHUD({mission,world}, mode);
  },
  fireCode: () => ui.keyboard.code('fire'),
}});
function fromHash(): void {
  const selected = new URLSearchParams(location.hash.slice(1));
  const screen = selected.get('screen');
  if (screen === 'home' || screen === 'playing' || screen === 'paused' || screen === 'result') {
    show(screen, selected.get('mode') === 'normal' ? 'normal' : 'easy', selected.get('outcome') === 'defeat' ? 'defeat' : 'victory');
  } else show('home');
}
fromHash();
window.addEventListener('hashchange', fromHash);
window.addEventListener('resize', () => { if (!failed) show(phase, mode, resultOutcome); });
window.addEventListener('pagehide', () => ui.dispose(), {once: true});
