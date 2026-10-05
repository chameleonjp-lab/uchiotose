/** Kaisen 3d751051 assistance; targets supply actual free-flight velocity. */
import { EASY_AIM_RADIUS, FLIGHT_CAMERA_BANK_FACTOR, FLIGHT_FOV, projectFlightTarget } from './flight-view';
import { add, scale, normalize, angle, clamp } from './world-math';
import type { FlightAircraft, FlightInput, FlightTarget, GameMode } from './flight-types';
import type { Vec3 } from './world-math';
export const PLAYER_MAX_PITCH = 0.95, EASY_AUTO_FIRE_RANGE = 1200;
export const OFFSCREEN_RESPONSE_MULTIPLIER = 1.65;
export const EASY_SHOT_CORRECTION_STRENGTH = 0.35, EASY_SHOT_MAX_ANGLE = 0.028, EASY_SHOT_PREDICTION_GATE = 0.16;
export function applyEasyShotCorrection(forward: Vec3, predicted: Vec3): Vec3 {
  const a = angle(forward, predicted);
  if (a > EASY_SHOT_PREDICTION_GATE || a < 1e-8) return { ...forward };
  const correction = Math.min(a * EASY_SHOT_CORRECTION_STRENGTH, EASY_SHOT_MAX_ANGLE);
  return normalize(add(scale(forward, Math.sin(a - correction) / Math.sin(a)), scale(predicted, Math.sin(correction) / Math.sin(a))));
}
export function getFlightAssist(player: FlightAircraft, enemies: readonly FlightTarget[], input: FlightInput, mode: GameMode) {
  const manualTurn = clamp(input.turn, -1, 1), manualClimb = clamp(input.climb, -1, 1);
  const aspect = Number.isFinite(input.viewAspect) && input.viewAspect! > 0 ? input.viewAspect! : 393 / 852;
  let target: { enemy: FlightTarget; projection: ReturnType<typeof projectFlightTarget> } | null = null;
  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue;
    const projection = projectFlightTarget(player, enemy.position, aspect, mode);
    if (!projection.visible) continue;
    if (!target || projection.distance < target.projection.distance) target = { enemy, projection };
  }
  const hasVisibleTarget = target !== null;
  const responseMultiplier = enemies.some(e => e.hp > 0) && !hasVisibleTarget ? OFFSCREEN_RESPONSE_MULTIPLIER : 1;
  if (mode !== 'easy' || !target) return { turn: manualTurn, climb: manualClimb, responseMultiplier, hasVisibleTarget };
  const { projection } = target;
  const screenRadius = Math.hypot(projection.x * Math.max(1, aspect), projection.y * Math.max(1, 1 / aspect)) / 2;
  const manualWeight = clamp(Math.max(Math.abs(manualTurn), Math.abs(manualClimb)) / 0.35, 0, 1);
  const assistFade = clamp((screenRadius - EASY_AIM_RADIUS) / (EASY_AIM_RADIUS * 2), 0, 1) * (1 - manualWeight);
  if (assistFade <= 0) return { turn: manualTurn, climb: manualClimb, responseMultiplier, hasVisibleTarget: true };
  const tanHalf = Math.tan(FLIGHT_FOV * Math.PI / 360), horizontalHalfFov = Math.atan(aspect * tanHalf);
  const screenHorizontal = projection.x * Math.tan(horizontalHalfFov), screenVertical = projection.y * tanHalf;
  const bankCos = Math.cos(player.bank * FLIGHT_CAMERA_BANK_FACTOR), bankSin = Math.sin(player.bank * FLIGHT_CAMERA_BANK_FACTOR);
  const viewYaw = Math.atan(screenHorizontal * bankCos + screenVertical * bankSin), viewPitch = Math.atan(-screenHorizontal * bankSin + screenVertical * bankCos);
  const requestedTurn = clamp(viewYaw / 0.18, -1, 1) * assistFade;
  const turn = manualTurn * requestedTurn < 0 ? manualTurn : clamp(manualTurn + requestedTurn, -1, 1);
  const manualPitch = manualClimb * PLAYER_MAX_PITCH, assistedPitch = player.pitch + viewPitch;
  const absolutePitch = Math.abs(manualClimb) > 0.05 && manualClimb * viewPitch < 0
    ? manualPitch : manualPitch + (assistedPitch - manualPitch) * assistFade;
  return { turn, climb: clamp(absolutePitch / PLAYER_MAX_PITCH, -1, 1), responseMultiplier, hasVisibleTarget: true };
}
export function autoFireTarget(player: FlightAircraft, enemies: readonly FlightTarget[], mode: GameMode, aspect?: number): FlightTarget | null {
  if (mode !== 'easy') return null;
  const safeAspect = Number.isFinite(aspect) && aspect! > 0 ? aspect! : 393 / 852;
  let best: FlightTarget | null = null, bestRadius = Infinity;
  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue;
    const p = projectFlightTarget(player, enemy.position, safeAspect, mode);
    const radius = Math.hypot(p.x * Math.max(1, safeAspect), p.y * Math.max(1, 1 / safeAspect));
    if (p.inCircle && p.distance <= EASY_AUTO_FIRE_RANGE && radius < bestRadius) { best = enemy; bestRadius = radius; }
  }
  return best;
}
export function shouldAutoFire(player: FlightAircraft, enemies: readonly FlightTarget[], mode: GameMode, aspect?: number): boolean {
  return autoFireTarget(player, enemies, mode, aspect) !== null;
}
