/** Numeric world mathematics. No rendering state or random source is used here. */
export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }
export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (v: Vec3, n: number): Vec3 => vec(v.x * n, v.y * n, v.z * n);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
export const normalize = (v: Vec3): Vec3 => scale(v, 1 / (length(v) || 1));
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));
export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
export const angle = (a: Vec3, b: Vec3): number => Math.acos(clamp(dot(a, b) / ((length(a) * length(b)) || 1), -1, 1));

/** Matches Three.js Euler YXZ, including the fixed source's negative bank. */
export function attitudeQuaternion(pitch: number, yaw: number, bank: number): Quat {
  const c1 = Math.cos(pitch / 2), c2 = Math.cos(yaw / 2), c3 = Math.cos(-bank / 2);
  const s1 = Math.sin(pitch / 2), s2 = Math.sin(yaw / 2), s3 = Math.sin(-bank / 2);
  return { x: s1 * c2 * c3 + c1 * s2 * s3, y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 - s1 * s2 * c3, w: c1 * c2 * c3 + s1 * s2 * s3 };
}
export function multiplyQuaternion(a: Quat, b: Quat): Quat {
  return { x: a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
    y: a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
    z: a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z };
}
export const inverseQuaternion = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export function transformDirection(v: Vec3, q: Quat): Vec3 {
  // Same unit-quaternion formulation as Three's Vector3.applyQuaternion.
  const t = scale(cross(vec(q.x, q.y, q.z), v), 2);
  return add(v, add(scale(t, q.w), cross(vec(q.x, q.y, q.z), t)));
}
export function quaternionAttitude(q: Quat): { pitch: number; yaw: number; bank: number } {
  const m23 = 2 * (q.y * q.z - q.w * q.x);
  const pitch = Math.asin(-clamp(m23, -1, 1));
  if (Math.abs(m23) < 0.9999999) return { pitch,
    yaw: Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)),
    bank: -Math.atan2(2 * (q.x * q.y + q.w * q.z), 1 - 2 * (q.x * q.x + q.z * q.z)) };
  return { pitch, yaw: Math.atan2(-2 * (q.x * q.z - q.w * q.y), 1 - 2 * (q.y * q.y + q.z * q.z)), bank: 0 };
}
export function normalizedAngle(n: number): number {
  let result = (n + Math.PI) % (Math.PI * 2);
  if (result < 0) result += Math.PI * 2;
  return result - Math.PI;
}
