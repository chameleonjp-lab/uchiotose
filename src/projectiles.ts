import type { AircraftRole, MissionState } from './roster';
import {
  segmentSphereHit, sweepIsland, sweepSea, sweptShipHit,
  type Vec3, type WorldState,
} from './world';

export const FIXED_DT = 1 / 60;
export const PROJECTILE_CAPACITIES = Object.freeze({ aircraft: 2048, magic: 256, antiAir: 64 });
export type ProjectileKind = 'mg' | 'cannon' | 'fire' | 'ice' | 'anti-air';
export type ProjectilePool = keyof typeof PROJECTILE_CAPACITIES;
export type SourceRole = AircraftRole | 'enemy' | 'ship';
export type PoolCapacities = Record<ProjectilePool, number>;

export interface Projectile {
  id: string;
  missionId: string;
  ownerId: string;
  sourceRoleAtFire: SourceRole;
  kind: ProjectileKind;
  firedTick: number;
  position: Vec3;
  previousPosition: Vec3;
  direction: Vec3;
  velocity: Vec3;
  distanceTravelledM: number;
  elapsedSeconds: number;
  lifetimeSeconds: number;
  baseDamage: number;
  radius: number;
}

export interface ProjectileImpact {
  id: string;
  t: number;
  projectile: Projectile;
  position: Vec3;
  targetId: string | null;
  surface: 'entity' | 'island' | 'sea';
  distanceTravelledM: number;
}

export function projectilePool(kind: ProjectileKind): ProjectilePool {
  return kind === 'fire' || kind === 'ice' ? 'magic' : kind === 'anti-air' ? 'antiAir' : 'aircraft';
}

export function projectileCounts(projectiles: readonly Projectile[]): Record<ProjectilePool, number> {
  const counts = { aircraft: 0, magic: 0, antiAir: 0 };
  for (const projectile of projectiles) counts[projectilePool(projectile.kind)] += 1;
  return counts;
}

export function makeProjectile(
  missionId: string, ordinal: number, ownerId: string, sourceRoleAtFire: SourceRole,
  kind: ProjectileKind, firedTick: number, origin: Vec3, direction: Vec3, speedMps: number, baseDamage: number,
): Projectile {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || !Number.isFinite(speedMps) || speedMps <= 0
    || !Number.isFinite(length) || length < 1e-12) throw new RangeError('Invalid projectile emission');
  const normalized = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
  return {
    id: `${missionId}:P${String(ordinal).padStart(9, '0')}`, missionId, ownerId, sourceRoleAtFire, kind, firedTick,
    position: { ...origin }, previousPosition: { ...origin }, direction: normalized,
    velocity: { x: normalized.x * speedMps, y: normalized.y * speedMps, z: normalized.z * speedMps },
    distanceTravelledM: 0, elapsedSeconds: 0,
    lifetimeSeconds: kind === 'fire' || kind === 'ice' ? 6 : kind === 'anti-air' ? 3 : 1.5,
    baseDamage, radius: kind === 'fire' || kind === 'ice' ? 1.5 : 0,
  };
}

function sub(left: Vec3, right: Vec3): Vec3 {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}
function lerp(from: Vec3, to: Vec3, fraction: number): Vec3 {
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction, z: from.z + (to.z - from.z) * fraction };
}

/** Every round resolves one earliest swept contact, even when that target dies earlier in this tick. */
export function advanceProjectiles(
  projectiles: readonly Projectile[], mission: MissionState, world: WorldState,
): { projectiles: Projectile[]; impacts: ProjectileImpact[] } {
  const survivors: Projectile[] = [];
  const impacts: ProjectileImpact[] = [];
  for (const projectile of [...projectiles].sort((left, right) => left.id.localeCompare(right.id))) {
    if (projectile.missionId !== mission.missionId) continue;
    const travelSeconds = Math.min(FIXED_DT, projectile.lifetimeSeconds - projectile.elapsedSeconds);
    if (travelSeconds <= 1e-12) continue;
    const tickFraction = travelSeconds / FIXED_DT;
    const from = projectile.position;
    const to = {
      x: from.x + projectile.velocity.x * travelSeconds,
      y: from.y + projectile.velocity.y * travelSeconds,
      z: from.z + projectile.velocity.z * travelSeconds,
    };
    let contact: { t: number; targetId: string | null; surface: ProjectileImpact['surface'] } | null = null;
    function consider(t: number | null, targetId: string | null, surface: ProjectileImpact['surface']): void {
      if (t === null || t < 0 || t > 1) return;
      if (contact === null || t < contact.t - 1e-12
        || (Math.abs(t - contact.t) <= 1e-12 && (targetId ?? surface) < (contact.targetId ?? contact.surface))) {
        contact = { t, targetId, surface };
      }
    }
    consider(sweepIsland(from, to, projectile.radius)?.t ?? null, null, 'island');
    consider(sweepSea(from, to, projectile.radius)?.t ?? null, null, 'sea');
    if (projectile.sourceRoleAtFire === 'enemy') {
      for (const aircraft of mission.aircraft) {
        const pose = world.aircraft[aircraft.id];
        if (aircraft.status !== 'active' || !pose) continue;
        const targetEnd = lerp(pose.previousPosition, pose.position, tickFraction);
        consider(segmentSphereHit(sub(from, pose.previousPosition), sub(to, targetEnd), { x: 0, y: 0, z: 0 }, pose.radius + projectile.radius), aircraft.id, 'entity');
      }
      for (const ship of mission.ships) {
        const pose = world.ships[ship.id];
        if (ship.status !== 'alive' || !pose) continue;
        consider(sweptShipHit(from, to, { ...pose, position: lerp(pose.previousPosition, pose.position, tickFraction) }, projectile.radius), ship.id, 'entity');
      }
    } else {
      for (const enemy of mission.enemies) {
        const pose = world.enemies[enemy.id];
        if (enemy.status !== 'active' || !pose) continue;
        const targetEnd = lerp(pose.previousPosition, pose.position, tickFraction);
        consider(segmentSphereHit(sub(from, pose.previousPosition), sub(to, targetEnd), { x: 0, y: 0, z: 0 }, pose.radius + projectile.radius), enemy.id, 'entity');
      }
    }
    const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y, projectile.velocity.z);
    // TypeScript cannot observe assignments performed by the nested consider callback.
    const first = contact as { t: number; targetId: string | null; surface: ProjectileImpact['surface'] } | null;
    if (first) {
      impacts.push({
        id: projectile.id, t: first.t * tickFraction, projectile, position: lerp(from, to, first.t),
        targetId: first.targetId, surface: first.surface,
        distanceTravelledM: projectile.distanceTravelledM + speed * travelSeconds * first.t,
      });
    } else if (projectile.elapsedSeconds + travelSeconds < projectile.lifetimeSeconds - 1e-12) {
      survivors.push({
        ...projectile, previousPosition: { ...from }, position: to,
        elapsedSeconds: projectile.elapsedSeconds + travelSeconds,
        distanceTravelledM: projectile.distanceTravelledM + speed * travelSeconds,
      });
    }
  }
  return { projectiles: survivors, impacts };
}
