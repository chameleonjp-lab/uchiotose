/** Fixed Kaisen manual bore sight: a 500 m convergence plane independent of targets. */
import { projectFlightTarget } from './flight-view';
import { add, scale, transformDirection, vec } from './world-math';
import type { FlightAircraft } from './flight-types';
export function projectGunSight(player: FlightAircraft, width: number, height: number) {
  const forward = transformDirection(vec(0, 0, -1), player.quaternion);
  const aim = add(add(transformDirection(vec(0, 0, -4.5), player.quaternion), player.position), scale(forward, 500));
  const p = projectFlightTarget(player, aim, width / height, 'normal');
  return { x: (p.x * 0.5 + 0.5) * width, y: (0.5 - p.y * 0.5) * height, depth: 500 };
}
