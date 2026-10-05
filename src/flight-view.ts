/** Fixed Kaisen chase camera, adapted to numeric world poses. */
import { add, sub, transformDirection, attitudeQuaternion, multiplyQuaternion, inverseQuaternion, distance } from './world-math';
import type { FlightAircraft, GameMode } from './flight-types';
import type { Vec3 } from './world-math';
export const FLIGHT_FOV = 64, FLIGHT_FAR = 6500, FLIGHT_VISIBILITY_RANGE = 1500;
export const FLIGHT_CAMERA_BANK_FACTOR = 0.45, EASY_AIM_RADIUS = 0.135;
const TAN_HALF_FOV = Math.tan(FLIGHT_FOV * Math.PI / 360);
export function getFlightCameraPose(player: FlightAircraft, mode: GameMode) {
  let rotation = multiplyQuaternion(player.quaternion, attitudeQuaternion(0, 0, -player.bank * (1 - FLIGHT_CAMERA_BANK_FACTOR)));
  const position = add(transformDirection({ x: 0, y: 11, z: 29 }, rotation), player.position);
  rotation = multiplyQuaternion(rotation, attitudeQuaternion(mode === 'easy' ? -Math.atan2(11, 479) : -0.19, 0, 0));
  return { position, rotation };
}
export function projectFlightTarget(player: FlightAircraft, target: Vec3, aspect: number, mode: GameMode) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 393 / 852;
  const { position, rotation } = getFlightCameraPose(player, mode);
  const local = transformDirection(sub(target, position), inverseQuaternion(rotation));
  const depth = -local.z, divisor = Math.max(0.0001, Math.abs(depth));
  const x = local.x / (divisor * TAN_HALF_FOV * safeAspect), y = local.y / (divisor * TAN_HALF_FOV);
  const d = distance(player.position, target);
  const visible = d <= FLIGHT_VISIBILITY_RANGE && depth > 0.1 && depth < FLIGHT_FAR && Math.abs(x) <= 1 && Math.abs(y) <= 1;
  const radial = Math.hypot(x * Math.max(1, safeAspect), y * Math.max(1, 1 / safeAspect)) / 2;
  return { x, y, depth, distance: d, visible, inCircle: visible && radial <= EASY_AIM_RADIUS };
}
