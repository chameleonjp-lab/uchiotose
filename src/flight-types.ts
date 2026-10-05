import type { Quat, Vec3 } from './world-math';

export type GameMode = 'normal' | 'easy';
export interface FlightInput {
  turn: number; climb: number; fire: boolean; loop: boolean;
  accelerate?: boolean; brake?: boolean; viewAspect?: number; steeringRevision?: number;
}
export interface FlightAircraft {
  position: Vec3; quaternion: Quat; yaw: number; pitch: number; bank: number;
  /** Baseline aerodynamic speed; ice changes displacement only. */
  speed: number; loopProgress: number; loopCooldown: number;
}
export interface FlightTarget {
  id: string; position: Vec3; velocity: Vec3; hp: number;
}
