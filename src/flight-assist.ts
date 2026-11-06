import { flightTargetKey, selectProjectedTarget, type FlightTargetLock } from './flight-target';
import { projectFlightTarget } from './flight-view';
import { clamp } from './world-math';
import type { FlightAircraft, FlightInput, FlightTarget, GameMode } from './flight-types';
export const PLAYER_MAX_PITCH = 0.95, EASY_AUTO_FIRE_RANGE = 1200;
/** Target location never contributes to steering in either mode. */
export function getFlightAssist(_player: FlightAircraft, _enemies: readonly FlightTarget[], input: FlightInput, _mode: GameMode, _lock?: FlightTargetLock) {
  return {turn:clamp(input.turn,-1,1),climb:clamp(input.climb,-1,1),responseMultiplier:1,hasVisibleTarget:false};
}
/** The provisional Easy trigger evaluates the live post-motion pose and viewport. */
export function autoFireTarget(player: FlightAircraft, enemies: readonly FlightTarget[], mode: GameMode, aspect?: number, lock?: FlightTargetLock): FlightTarget | null {
  if(mode!=='easy')return null;
  const safeAspect=Number.isFinite(aspect)&&aspect!>0?aspect!:393/852;
  const candidates=enemies.filter(e=>e.hp>0).map(enemy=>({enemy,key:flightTargetKey(enemy),projection:projectFlightTarget(player,enemy.position,safeAspect,mode)}))
    .filter(c=>c.projection.inCircle&&c.projection.distance<=EASY_AUTO_FIRE_RANGE);
  return selectProjectedTarget(candidates,safeAspect,EASY_AUTO_FIRE_RANGE,lock)?.enemy??null;
}
export function shouldAutoFire(player: FlightAircraft, enemies: readonly FlightTarget[], mode: GameMode, aspect?: number): boolean {
  return autoFireTarget(player,enemies,mode,aspect)!==null;
}
