/** Original closed rock island, one metre per world unit; shared by draw and sweep. */
import { cross, dot, normalize, sub, vec } from './world-math';
import type { Vec3 } from './world-math';
export const ISLAND_RADIUS = 1000;
export const ISLAND_TOP = 800;
export const ISLAND_BOTTOM = 300;
export const ISLAND_SIDES = 16;
export const ISLAND_RINGS = Object.freeze([
  Object.freeze({ radius: 150, y: 300 }), Object.freeze({ radius: 650, y: 500 }),
  Object.freeze({ radius: 1000, y: 700 }), Object.freeze({ radius: 900, y: 800 }),
]);
export const ISLAND_VERTICES: readonly Vec3[] = Object.freeze(ISLAND_RINGS.flatMap(ring =>
  Array.from({ length: ISLAND_SIDES }, (_, i) => Object.freeze(vec(Math.cos(i * Math.PI * 2 / ISLAND_SIDES) * ring.radius,
    ring.y, Math.sin(i * Math.PI * 2 / ISLAND_SIDES) * ring.radius)))));
const triangles: number[] = [];
const interior = vec(0, 600, 0);
function triangle(a: number, b: number, c: number) {
  const normal = normalize(cross(sub(ISLAND_VERTICES[b], ISLAND_VERTICES[a]), sub(ISLAND_VERTICES[c], ISLAND_VERTICES[a])));
  if (dot(normal, sub(interior, ISLAND_VERTICES[a])) > 0) triangles.push(a, c, b);
  else triangles.push(a, b, c);
}
for (let ring = 0; ring < ISLAND_RINGS.length - 1; ring++) for (let i = 0; i < ISLAND_SIDES; i++) {
  const j = (i + 1) % ISLAND_SIDES, a = ring * ISLAND_SIDES + i, b = ring * ISLAND_SIDES + j;
  triangle(a, b, a + ISLAND_SIDES); triangle(b, b + ISLAND_SIDES, a + ISLAND_SIDES);
}
for (let i = 1; i < ISLAND_SIDES - 1; i++) {
  triangle(0, i, i + 1);
  const top = (ISLAND_RINGS.length - 1) * ISLAND_SIDES;
  triangle(top, top + i, top + i + 1);
}
export const ISLAND_TRIANGLES = Object.freeze(triangles);
export interface CollisionPlane { normal: Vec3; limit: number }
const planes: CollisionPlane[] = [];
for (let i = 0; i < triangles.length; i += 3) {
  const a = ISLAND_VERTICES[triangles[i]], b = ISLAND_VERTICES[triangles[i + 1]], c = ISLAND_VERTICES[triangles[i + 2]];
  const normal = normalize(cross(sub(b, a), sub(c, a))), limit = dot(normal, a);
  if (!planes.some(p => dot(p.normal, normal) > 1 - 1e-9 && Math.abs(p.limit - limit) < 1e-7)) planes.push(Object.freeze({ normal: Object.freeze(normal), limit }));
}
export const ISLAND_PLANES: readonly CollisionPlane[] = Object.freeze(planes);

export interface TerrainHit { t: number; point: Vec3; normal: Vec3; kind: 'island' | 'sea' }
/** Slab entry to a closed convex rock. Face padding is conservative at rock edges. */
export function sweepIsland(from: Vec3, to: Vec3, radius = 0): TerrainHit | null {
  if (!Number.isFinite(radius) || radius < 0 || !Number.isFinite(from.x + from.y + from.z + to.x + to.y + to.z)) return null;
  if (Math.min(from.y, to.y) > ISLAND_TOP + radius || Math.max(from.y, to.y) < ISLAND_BOTTOM - radius ||
    Math.min(from.x, to.x) > ISLAND_RADIUS + radius || Math.max(from.x, to.x) < -ISLAND_RADIUS - radius ||
    Math.min(from.z, to.z) > ISLAND_RADIUS + radius || Math.max(from.z, to.z) < -ISLAND_RADIUS - radius) return null;
  let enter = 0, exit = 1, normal = vec(0, 1, 0), nearest = -Infinity;
  for (const plane of ISLAND_PLANES) {
    const rawA = dot(plane.normal, from) - plane.limit - radius, rawB = dot(plane.normal, to) - plane.limit - radius;
    // Exact shared-edge points can differ by a last floating-point bit after plane compilation.
    const a = Math.abs(rawA) < 1e-10 ? 0 : rawA, b = Math.abs(rawB) < 1e-10 ? 0 : rawB;
    if (a > nearest) { nearest = a; if (enter === 0) normal = { ...plane.normal }; }
    if (a > 1e-10 && b > 1e-10) return null;
    if (a <= 0 && b <= 0) continue;
    const t = a / (a - b);
    if (a > 0 && t > enter) { enter = t; normal = { ...plane.normal }; }
    else if (a <= 0) exit = Math.min(exit, t);
    if (enter > exit + 1e-10) return null;
  }
  if (enter > 1 || exit < 0) return null;
  return { t: Math.max(0, enter), point: vec(from.x + (to.x - from.x) * enter, from.y + (to.y - from.y) * enter,
    from.z + (to.z - from.z) * enter), normal, kind: 'island' };
}
/** Sea damage uses the specified level y=0; ocean ripples are presentation only. */
export function sweepSea(from: Vec3, to: Vec3, radius = 0): TerrainHit | null {
  if (!Number.isFinite(radius) || radius < 0 || !Number.isFinite(from.y + to.y)) return null;
  if (from.y <= radius) return { t: 0, point: { ...from }, normal: vec(0, 1, 0), kind: 'sea' };
  if (to.y > radius) return null;
  const t = (from.y - radius) / (from.y - to.y);
  return { t, point: vec(from.x + (to.x - from.x) * t, radius, from.z + (to.z - from.z) * t), normal: vec(0, 1, 0), kind: 'sea' };
}
export function lineOfSight(from: Vec3, to: Vec3): boolean { return sweepIsland(from, to) === null && sweepSea(from, to) === null; }
