/** Kaisen 3d751051 flight.ts: numeric adapter; aerodynamic equations are retained. */
import { PLAYER_MAX_PITCH } from './flight-assist';
import { add, scale, sub, length, vec, normalize, attitudeQuaternion, quaternionAttitude, transformDirection } from './world-math';
import type { FlightAircraft, FlightInput, GameMode } from './flight-types';
export { clamp } from './world-math';
export { normalizedAngle as normalizeAngle } from './world-math';
import { clamp, normalizedAngle as normalizeAngle } from './world-math';

export const CRUISE_SPEED = 110, MAX_SPEED = 141, STALL_SPEED = 65;
export const LOOP_DURATION = 5, LOOP_COOLDOWN = 2, THROTTLE_ADJUST_RATE = 18;
export const ENEMY_MAX_PITCH = 0.62;
const MAX_YAW_RATE = 0.82, MAX_BANK = 0.72, EPSILON = 1e-8;

export interface FlightController {
  playerTargetSpeed: number; loopHeld: boolean; playerLoopActive: boolean;
  loopStartYaw: number; loopStartPitch: number; loopStartSteeringRevision: number | undefined;
  loopStartTurn: number; loopStartClimb: number;
  assistTurn: number; assistClimb: number; responseMultiplier: number;
}
export function createFlightController(player: FlightAircraft): FlightController {
  return { playerTargetSpeed: CRUISE_SPEED, loopHeld: false, playerLoopActive: false,
    loopStartYaw: player.yaw, loopStartPitch: player.pitch, loopStartSteeringRevision: undefined,
    loopStartTurn: 0, loopStartClimb: 0, assistTurn: 0, assistClimb: 0, responseMultiplier: 1 };
}
export function updateQuaternion(plane: FlightAircraft): void {
  plane.quaternion = attitudeQuaternion(plane.pitch, plane.yaw, plane.bank);
}
export function forwardOf(plane: FlightAircraft) {
  return normalize(transformDirection(vec(0, 0, -1), plane.quaternion));
}
export function updateAircraftMotion(
  plane: FlightAircraft, turnInput: number, climbInput: number, dt: number,
  preferredSpeed: number, looping = false, speedCeiling = MAX_SPEED,
  maxPitch = ENEMY_MAX_PITCH, responseMultiplier = 1, authoritySpeed = plane.speed,
): void {
  const turn = clamp(turnInput, -1, 1), climb = clamp(climbInput, -1, 1);
  const lowSpeedAuthority = authoritySpeed <= STALL_SPEED + 20
    ? 0.92 + ((authoritySpeed - STALL_SPEED) / 20) * 0.23
    : authoritySpeed <= CRUISE_SPEED
      ? 1.15 - ((authoritySpeed - (STALL_SPEED + 20)) / (CRUISE_SPEED - (STALL_SPEED + 20))) * 0.15 : 1;
  const highSpeedLoad = clamp(1 - Math.max(0, authoritySpeed - 115) * 0.008, 0.78, 1);
  const authority = lowSpeedAuthority * highSpeedLoad;
  if (!looping) {
    plane.pitch += (climb * maxPitch - plane.pitch) * (1 - Math.exp(-dt * 4.2));
    plane.yaw = normalizeAngle(plane.yaw - turn * MAX_YAW_RATE * authority * responseMultiplier * dt);
    plane.bank += (turn * MAX_BANK - plane.bank) * (1 - Math.exp(-dt * 5.5));
  } else plane.bank += -plane.bank * (1 - Math.exp(-dt * 3));
  const turnDrag = Math.abs(turn) * 2.7, climbDrag = Math.max(0, climb) * 2.1;
  const loopDrag = looping ? 4.8 : 0, pitchEnergy = Math.sin(plane.pitch) * 2.6;
  const trim = (preferredSpeed - plane.speed) * 0.72;
  plane.speed = clamp(plane.speed + (trim - turnDrag - climbDrag - loopDrag - pitchEnergy) * dt,
    STALL_SPEED, Math.max(STALL_SPEED, speedCeiling));
  updateQuaternion(plane);
  plane.position = add(plane.position, scale(forwardOf(plane), plane.speed * dt));
}
export function desiredFlightInput(plane: FlightAircraft, target: import('./world-math').Vec3): { turn: number; climb: number } {
  const direction = sub(target, plane.position), horizontal = Math.hypot(direction.x, direction.z);
  if (length(direction) ** 2 < EPSILON) return { turn: 0, climb: 0 };
  const yawInput = horizontal < EPSILON ? 0 : clamp(-normalizeAngle(Math.atan2(-direction.x, -direction.z) - plane.yaw) / 0.7, -1, 1);
  return { turn: yawInput, climb: clamp(Math.atan2(direction.y, Math.max(horizontal, EPSILON)) / ENEMY_MAX_PITCH, -1, 1) };
}
export function updatePlayerLoop(
  player: FlightAircraft, meta: FlightController, input: FlightInput, userInput: FlightInput,
  loopPressed: boolean, dt: number, preferredSpeed: number, speedCeiling: number, responseMultiplier: number, authoritySpeed = player.speed,
): boolean {
  if (player.loopCooldown > 0) player.loopCooldown = Math.max(0, player.loopCooldown - dt);
  const revisionChanged = meta.loopStartSteeringRevision !== undefined && userInput.steeringRevision !== undefined
    && userInput.steeringRevision !== meta.loopStartSteeringRevision;
  const commandChanged = Math.abs(userInput.turn - meta.loopStartTurn) > EPSILON || Math.abs(userInput.climb - meta.loopStartClimb) > EPSILON;
  const steeringChanged = meta.loopStartSteeringRevision !== undefined && userInput.steeringRevision !== undefined ? revisionChanged : commandChanged;
  if (player.loopProgress > 0 && steeringChanged) {
    player.loopProgress = 0; player.loopCooldown = LOOP_COOLDOWN; meta.playerLoopActive = false;
    const recoveryPitch = clamp(userInput.climb, -1, 1) * PLAYER_MAX_PITCH;
    const attitude = quaternionAttitude(player.quaternion), recoveryBank = clamp(userInput.turn, -1, 1) * MAX_BANK;
    player.pitch = recoveryPitch + normalizeAngle(attitude.pitch - recoveryPitch);
    player.yaw = attitude.yaw; player.bank = recoveryBank + normalizeAngle(attitude.bank - recoveryBank);
    updateAircraftMotion(player, userInput.turn, userInput.climb, dt, preferredSpeed, false, speedCeiling, PLAYER_MAX_PITCH, responseMultiplier, authoritySpeed);
    return false;
  }
  if (player.loopProgress <= 0 && loopPressed && player.loopCooldown <= EPSILON && player.speed >= STALL_SPEED) {
    player.loopProgress = EPSILON; meta.playerLoopActive = true; meta.loopStartYaw = player.yaw; meta.loopStartPitch = player.pitch;
    meta.loopStartSteeringRevision = userInput.steeringRevision; meta.loopStartTurn = userInput.turn; meta.loopStartClimb = userInput.climb;
  }
  if (player.loopProgress <= 0) {
    updateAircraftMotion(player, input.turn, input.climb, dt, preferredSpeed, false, speedCeiling, PLAYER_MAX_PITCH, responseMultiplier, authoritySpeed);
    return false;
  }
  if (!meta.playerLoopActive) { meta.playerLoopActive = true; meta.loopStartYaw = player.yaw; meta.loopStartPitch = player.pitch; }
  const progress = clamp(player.loopProgress + dt / LOOP_DURATION, 0, 1);
  player.loopProgress = progress; player.yaw = meta.loopStartYaw; player.pitch = meta.loopStartPitch + progress * Math.PI * 2;
  const completed = progress >= 1 - EPSILON;
  if (completed) { player.yaw = meta.loopStartYaw; player.pitch = meta.loopStartPitch; player.loopProgress = 0;
    player.loopCooldown = LOOP_COOLDOWN; meta.playerLoopActive = false; }
  updateAircraftMotion(player, 0, 0, dt, preferredSpeed, true, speedCeiling, PLAYER_MAX_PITCH, responseMultiplier, authoritySpeed);
  return completed;
}
export function advanceThrottle(meta: FlightController, input: FlightInput, mode: GameMode, dt: number): number {
  const direction = mode === 'easy' ? 0 : Number(Boolean(input.accelerate)) - Number(Boolean(input.brake));
  meta.playerTargetSpeed = clamp(meta.playerTargetSpeed + direction * THROTTLE_ADJUST_RATE * dt, STALL_SPEED, MAX_SPEED);
  return meta.playerTargetSpeed;
}
