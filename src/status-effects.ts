import type { BurnState, IceState } from './roster';

export const BURN_DAMAGE_PER_SECOND = 8;
export const BURN_DURATION_SECONDS = 1;
export const BURN_CAPACITY = 512;
export const ICE_DURATION_TICKS = 300;
export const ICE_SLOWDOWN_MPS = 50 / 3.6;

export interface BurnEffect extends BurnState { targetId: string }
export interface BurnIntegration {
  hp: number;
  damage: number;
  burns: BurnState[];
  deathAtSeconds: number | null;
}

/** One independent interval per fireball; the logical pool is shared by all targets. */
export function addBurn(
  burns: readonly BurnState[], projectileId: string, targetId: string,
  hitAtSeconds: number, sharedCount: number,
): BurnState[] {
  if (!Number.isFinite(hitAtSeconds) || hitAtSeconds < 0) throw new RangeError('Invalid fire impact time');
  if (burns.some(effect => effect.projectileId === projectileId)) return burns.slice();
  if (sharedCount >= BURN_CAPACITY || burns.length >= BURN_CAPACITY) {
    throw new Error('Logical fire effect capacity exhausted');
  }
  const effect: BurnEffect = {
    projectileId, targetId, startsAtSeconds: hitAtSeconds,
    endsAtSeconds: hitAtSeconds + BURN_DURATION_SECONDS,
  };
  return [...burns, effect];
}

/** Integrate overlap, including exact deaths between tick boundaries and staggered expiry. */
export function integrateBurns(
  hp: number, burns: readonly BurnState[], fromSeconds: number, toSeconds: number,
): BurnIntegration {
  if (!Number.isFinite(hp) || hp < 0 || !Number.isFinite(fromSeconds)
    || !Number.isFinite(toSeconds) || toSeconds < fromSeconds) throw new RangeError('Invalid burn interval');
  if (hp === 0) return { hp: 0, damage: 0, burns: [], deathAtSeconds: null };
  const boundaries = [...new Set([
    fromSeconds, toSeconds,
    ...burns.flatMap(effect => [effect.startsAtSeconds, effect.endsAtSeconds])
      .filter(time => time > fromSeconds && time < toSeconds),
  ])].sort((left, right) => left - right);
  let remainingHp = hp;
  for (let index = 1; index < boundaries.length; index += 1) {
    const from = boundaries[index - 1];
    const to = boundaries[index];
    const rate = burns.filter(effect => effect.startsAtSeconds <= from && effect.endsAtSeconds > from).length
      * BURN_DAMAGE_PER_SECOND;
    if (rate === 0) continue;
    const damage = rate * (to - from);
    if (damage >= remainingHp - 1e-12) {
      return { hp: 0, damage: hp, burns: [], deathAtSeconds: from + remainingHp / rate };
    }
    remainingHp -= damage;
  }
  return {
    hp: remainingHp, damage: hp - remainingHp,
    burns: burns.filter(effect => effect.endsAtSeconds > toSeconds), deathAtSeconds: null,
  };
}

export function isIceActive(ice: IceState | null, tick: number): boolean {
  return ice !== null && tick >= ice.startsAtTick && tick < ice.expiresAtTick;
}

/** Repeat hits refresh the deadline, preserving an already active interval. */
export function applyIceHit(ice: IceState | null, hitTick: number): IceState {
  if (!Number.isSafeInteger(hitTick) || hitTick < 0) throw new RangeError('Invalid ice impact tick');
  const startsAtTick = hitTick + 1;
  const expiresAtTick = startsAtTick + ICE_DURATION_TICKS;
  return {
    startsAtTick: ice && ice.expiresAtTick > hitTick ? Math.min(ice.startsAtTick, startsAtTick) : startsAtTick,
    expiresAtTick: Math.max(ice?.expiresAtTick ?? 0, expiresAtTick),
  };
}

export function expireIce(ice: IceState | null, tick: number): IceState | null {
  return ice && ice.expiresAtTick > tick ? ice : null;
}

export function iceAdjustedSpeed(baseSpeedMps: number, ice: IceState | null, tick: number, kind: 'aircraft' | 'ship'): number {
  return Math.max(kind === 'aircraft' ? 65 : 0, baseSpeedMps - (isIceActive(ice, tick) ? ICE_SLOWDOWN_MPS : 0));
}

export function remainingBurnSeconds(burns: readonly BurnState[], timeSeconds: number): number {
  return burns.reduce((remaining, effect) => Math.max(remaining, effect.endsAtSeconds - timeSeconds), 0);
}

export function remainingIceSeconds(ice: IceState | null, tick: number): number {
  return ice ? Math.max(0, ice.expiresAtTick - Math.max(tick, ice.startsAtTick)) / 60 : 0;
}
