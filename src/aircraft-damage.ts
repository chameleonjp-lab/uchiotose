/** Adapted from Kaisen 3d751051 src/aircraft-damage.ts; enemy-aircraft weapons are omitted. */
export type AircraftWeaponKind = 'mg' | 'cannon';
export const AIRCRAFT_DAMAGE_BANDS = Object.freeze([
  Object.freeze({ fromMetres: 0, mg: 1, cannon: 1 }),
  Object.freeze({ fromMetres: 200, mg: 0.75, cannon: 0.9 }),
  Object.freeze({ fromMetres: 500, mg: 0.5, cannon: 0.8 }),
  Object.freeze({ fromMetres: 800, mg: 0.25, cannon: 0.7 }),
]);

/** Cumulative muzzle-to-impact path; each boundary belongs to the farther band. */
export function aircraftDamageMultiplier(kind: AircraftWeaponKind, distanceMetres: number): number {
  if (!Number.isFinite(distanceMetres) || distanceMetres < 0) throw new RangeError('Aircraft round distance must be finite and nonnegative');
  for (let index = AIRCRAFT_DAMAGE_BANDS.length - 1; index >= 0; index -= 1) {
    if (distanceMetres >= AIRCRAFT_DAMAGE_BANDS[index].fromMetres) return AIRCRAFT_DAMAGE_BANDS[index][kind];
  }
  return 1;
}
