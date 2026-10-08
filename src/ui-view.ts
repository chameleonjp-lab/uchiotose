import type { GameMode } from './flight-types';
import { getRosterCounts, type MissionState } from './roster';
import type { ResultSnapshot, ScoreBreakdown } from './scoring';
import type { UIPhase } from './ui-controller';

// Shared production presentation. The UI-only harness supplies display data;
// simulation, graphics preparation, audio, and mission progression stay in main.
export interface ScreenState {
  phase: UIPhase;
  mode: GameMode;
  ready: boolean;
  faulted: boolean;
  contextLost: boolean;
}
export interface HUDState {
  mission: MissionState;
  world: { aircraft: Record<string, { position: { x: number; y: number; z: number } }> };
}
export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing UI: ${id}`);
  return node as T;
}
export function text(id: string, value: string): void { const node = document.getElementById(id); if (node && node.textContent !== value) node.textContent = value; }
export function homeStatus(message: string, prepared = false): void {
  text('p1-status', message);
  el('p1-status').hidden = prepared;
}
function time(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
export function renderScreen({phase, mode, ready, faulted, contextLost}: ScreenState): void {
  const app = el('app');
  app.dataset.screen = phase;
  app.dataset.mode = mode;
  el<HTMLButtonElement>('start').disabled = !ready || faulted || contextLost;
  for (const id of ['retry','pause-restart']) el<HTMLButtonElement>(id).disabled = faulted || contextLost;
  el<HTMLButtonElement>('resume').disabled = faulted || contextLost;
  for (const [id, visible] of [
    ['home', phase === 'home'], ['hud', phase === 'playing' || phase === 'paused'],
    ['pause-screen', phase === 'paused'], ['result', phase === 'result'],
  ] as const) el(id).hidden = !visible;
}

export function focusScreen(phase: UIPhase): void {
  const focus = phase === 'home' ? 'start' : phase === 'paused' ? 'resume' : phase === 'result' ? 'retry' : 'flight';
  const preferred = el<HTMLButtonElement>(focus);
  const fallback = phase === 'home' ? 'home-settings' : phase === 'paused' ? 'home-return' : 'result-home';
  (preferred.disabled ? el(fallback) : preferred).focus({preventScroll: true});
}

export function renderHUD(state: HUDState, mode: GameMode): void {
  const mission = state.mission, counts = getRosterCounts(mission);
  const player = mission.aircraft.find(item => item.id === mission.controlledAircraftId);
  const pose = player ? state.world.aircraft[player.id] : null;
  text('hud-time', time(mission.tick / 60));
  text('hud-mode', mode === 'easy' ? 'イージー' : 'ノーマル');
  text('hud-hp', player ? `${Math.ceil(player.hp)} / 80` : '復帰待ち');
  text('hud-speed', player ? `${Math.round(player.actualSpeedMps * 3.6)} km/h` : '—');
  text('hud-altitude', pose ? `${Math.round(pose.position.y)} m` : '—');
  text('hud-ammo', player ? player.reloadUntilTick !== null ? `装填 ${Math.max(0, (player.reloadUntilTick - mission.tick) / 60).toFixed(1)}秒` : `機銃 ${player.machineGunAmmo} / 機関砲 ${player.cannonAmmo}` : '—');
  const burnSeconds = player?.burns.reduce((max, effect) => Math.max(max, effect.endsAtSeconds - mission.tick / 60), 0) ?? 0;
  const iceSeconds = player?.ice ? Math.max(0, (player.ice.expiresAtTick - mission.tick) / 60) : 0;
  text('hud-effects', [burnSeconds > 0 ? `火傷 ${burnSeconds.toFixed(1)}秒` : '', iceSeconds > 0 ? `氷 ${iceSeconds.toFixed(1)}秒 · 最低234km/h` : ''].filter(Boolean).join(' / ') || '状態異常なし');
  text('hud-aircraft', `${counts.aircraft.remaining}/50`);
  text('hud-ships', `${counts.ships.alive}/10`);
  text('hud-enemies', `${counts.enemies.remaining}/100`);
  text('hud-aircraft-active', `出撃 ${counts.aircraft.active}/8`);
  text('hud-enemies-active', `出撃 ${counts.enemies.active}/24`);
  const health = document.querySelector<HTMLElement>('.health-track > i');
  const healthWidth = `${(player?.hp ?? 0) / 80 * 100}%`;
  if (health && health.style.width !== healthWidth) health.style.width = healthWidth;
  const pending = mission.aircraft.find(item => item.status === 'pending' && item.role === 'player');
  text('hud-respawn', player ? '' : pending?.reservation ? `自機復帰まで ${Math.max(0, (pending.reservation.dueTick - mission.tick) / 60).toFixed(1)}秒` : '生存僚機への操縦引継ぎ中');
  const warning = pose ? pose.position.y < 150 ? '海面接近 · 上昇してください' : Math.hypot(pose.position.x, pose.position.z) > 5500 || pose.position.y > 2300 ? '戦場境界 · 島へ戻ってください' : Math.hypot(pose.position.x, pose.position.z) < 1300 && pose.position.y < 1000 ? '浮遊島接近 · 衝突に注意' : '' : '';
  text('hud-warning', warning);
}

export function renderResult(result: ResultSnapshot, breakdown: ScoreBreakdown, mode: GameMode): void {
  text('result-title', result.outcome === 'victory' ? '作戦成功' : '作戦失敗');
  text('result-mode', mode === 'easy' ? 'イージー' : 'ノーマル');
  const reasons = {'all-enemies-defeated': '敵の飛行戦士100人を撃破しました', 'aircraft-exhausted': '味方航空隊の総残機が0になりました', 'fleet-destroyed': '味方艦隊が全滅しました', 'mutual-destruction': '同時全滅 · 艦隊防衛に失敗しました'};
  text('result-reason', reasons[result.reason]);
  text('result-time-label', result.outcome === 'victory' ? '全滅までの時間' : '経過時間');
  text('result-time', time(result.elapsedSeconds));
  text('result-score', result.score.toLocaleString('ja-JP'));
  text('result-score-version', `${result.rulesVersion} · 最終合計は四捨五入。内訳の表示丸めで差が出る場合があります`);
  const rows = [
    [`敵撃破 ${breakdown.kills}/100`, breakdown.killPoints],
    [`自機実損傷 ${breakdown.playerDamage.toFixed(2)} HP`, breakdown.damagePoints],
    ['時間加点', breakdown.timeBonus],
    [`自機損失 ${result.losses.player}機`, breakdown.playerLossPenalty],
    [`僚機損失 ${result.losses.wing}機`, breakdown.wingLossPenalty],
    [`艦損失 ${result.losses.ships}隻`, breakdown.shipLossPenalty],
  ] as const;
  const container = document.getElementById('result-breakdown');
  if (container) {
    const fragment = document.createDocumentFragment();
    for (const [label, value] of rows) {
      const row = document.createElement('div'), term = document.createElement('dt'), detail = document.createElement('dd');
      term.textContent = label; detail.textContent = value.toLocaleString('ja-JP', {maximumFractionDigits: 2});
      row.append(term, detail); fragment.append(row);
    }
    container.replaceChildren(fragment);
  }
}

export const RUNTIME_FAILURE_REASON = '処理を継続できません。ページを再読み込みしてください';
/** Display errors without owning failure detection, recovery or simulation. */
export function renderFailureStatus(kind: 'prepare' | 'runtime', phase: UIPhase): void {
  homeStatus(kind === 'prepare'
    ? '3D描画を起動できません。WebGL対応ブラウザで再読み込みしてください'
    : '描画または作戦処理が中断されました。ページを再読み込みしてください');
  if (kind === 'runtime') {
    text('pause-reason', RUNTIME_FAILURE_REASON);
    if (phase === 'result') text('result-reason', `${el('result-reason').textContent} 描画が中断されました。再出撃にはページを再読み込みしてください。`);
  }
}
