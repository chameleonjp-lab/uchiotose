import type { AircraftRole, EnemyId, LossTotals, MissionState, RosterOutcome } from './roster';

export interface EnemyDamageLedger {
  total: number;
  player: number;
  events: Record<string, number>;
}

export interface ScoreLedger {
  enemies: Record<EnemyId, EnemyDamageLedger>;
  playerDamage: number;
}

export interface ScoreBreakdown {
  kills: number;
  playerDamage: number;
  killPoints: number;
  damagePoints: number;
  timeBonus: number;
  playerLossPenalty: number;
  wingLossPenalty: number;
  shipLossPenalty: number;
  rawTotal: number;
  total: number;
}

export interface ResultSnapshot {
  missionId: string;
  rulesVersion: string;
  mode: 'easy' | 'normal';
  outcome: RosterOutcome;
  reason: 'all-enemies-defeated' | 'aircraft-exhausted' | 'fleet-destroyed' | 'mutual-destruction';
  tick: number;
  elapsedSeconds: number;
  losses: Readonly<LossTotals>;
  breakdown: Readonly<ScoreBreakdown>;
  score: number;
}

export function createScoreLedger(mission: MissionState): ScoreLedger {
  return {
    enemies: Object.fromEntries(mission.enemies.map(enemy => [enemy.id, { total: 0, player: 0, events: {} }])) as ScoreLedger['enemies'],
    playerDamage: 0,
  };
}

/** Idempotent event accounting. Only actual enemy HP reduction can enter the ledger. */
export function recordEnemyDamage(
  ledger: ScoreLedger, enemyId: EnemyId, eventId: string, beforeHp: number,
  requestedDamage: number, sourceRoleAtFire: AircraftRole | 'ship',
): { ledger: ScoreLedger; actualDamage: number } {
  const entry = ledger.enemies[enemyId];
  if (!entry) throw new Error(`Unknown enemy ${enemyId}`);
  if (!Number.isFinite(beforeHp) || beforeHp < 0 || !Number.isFinite(requestedDamage) || requestedDamage < 0) {
    throw new RangeError('Invalid damage accounting');
  }
  if (Object.hasOwn(entry.events, eventId)) return { ledger, actualDamage: 0 };
  // HP is authoritative. Capping the returned damage by a separately accumulated
  // ledger can strand a fractional HP residue after floating-point summation.
  const actualDamage = Math.max(0, Math.min(beforeHp, requestedDamage));
  if (actualDamage === 0) return { ledger, actualDamage: 0 };
  const playerDamage = sourceRoleAtFire === 'player' ? Math.min(actualDamage, Math.max(0, 80 - entry.player)) : 0;
  const nextEntry = {
    total: Math.min(80, entry.total + actualDamage), player: Math.min(80, entry.player + playerDamage),
    events: { ...entry.events, [eventId]: actualDamage },
  };
  return {
    ledger: { enemies: { ...ledger.enemies, [enemyId]: nextEntry }, playerDamage: Math.min(8000, ledger.playerDamage + playerDamage) },
    actualDamage,
  };
}

export function scoreBreakdown(ledger: ScoreLedger, losses: LossTotals, elapsedSeconds: number, victory = false): ScoreBreakdown {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || !Number.isFinite(ledger.playerDamage)
    || ledger.playerDamage < 0 || ledger.playerDamage > 8000 + 1e-8
    || losses.enemies < 0 || losses.enemies > 100 || losses.player < 0 || losses.wing < 0
    || losses.player + losses.wing > 50 || losses.ships < 0 || losses.ships > 10) {
    throw new RangeError('Score outside the finite mission bounds');
  }
  const killPoints = 100 * losses.enemies;
  const damagePoints = 5 * ledger.playerDamage;
  const timeBonus = victory ? 10000 * Math.max(0, 1 - elapsedSeconds / 600) * (ledger.playerDamage / 8000) : 0;
  const playerLossPenalty = -500 * losses.player;
  const wingLossPenalty = -200 * losses.wing;
  const shipLossPenalty = -1000 * losses.ships;
  const rawTotal = killPoints + damagePoints + timeBonus + playerLossPenalty + wingLossPenalty + shipLossPenalty;
  return {
    kills: losses.enemies, playerDamage: ledger.playerDamage, killPoints, damagePoints, timeBonus,
    playerLossPenalty, wingLossPenalty, shipLossPenalty, rawTotal, total: Math.round(rawTotal),
  };
}

/** A result is captured once, with nested values frozen before the view receives it. */
export function createResultSnapshot(mission: MissionState, ledger: ScoreLedger, mode: 'easy' | 'normal'): ResultSnapshot {
  if (!mission.finalized || mission.outcome === null) throw new Error('Result requires a terminal mission');
  const losses = Object.freeze({ ...mission.losses });
  const elapsedSeconds = mission.tick / 60;
  const breakdown = Object.freeze(scoreBreakdown(ledger, losses, elapsedSeconds, mission.outcome === 'victory'));
  const reason = mission.outcome === 'victory' ? 'all-enemies-defeated'
    : losses.enemies === 100 ? 'mutual-destruction'
      : losses.player + losses.wing === 50 ? 'aircraft-exhausted' : 'fleet-destroyed';
  return Object.freeze({
    missionId: mission.missionId, rulesVersion: mission.rulesVersion, mode, outcome: mission.outcome,
    reason, tick: mission.tick, elapsedSeconds, losses, breakdown, score: breakdown.total,
  });
}
