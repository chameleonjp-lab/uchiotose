/** Kaisen 3d751051 ammunition contract adapted to finite IDs and wing magazines. */
import type { Aircraft, Enemy, MissionState, Ship } from './roster';

export const MACHINE_GUN_CAPACITY = 288;
export const CANNON_CAPACITY = 96;
export const AIRCRAFT_RELOAD_TICKS = 360;
export const ENEMY_RELOAD_TICKS = 180;
export const SHIP_RELOAD_TICKS = 240;
export type AircraftWeapon = 'mg' | 'cannon';

export const AIRCRAFT_WEAPONS = Object.freeze({
  player: Object.freeze({ mg: Object.freeze({ period: 5, damage: 4 }), cannon: Object.freeze({ period: 15, damage: 20 }) }),
  wing: Object.freeze({ mg: Object.freeze({ period: 17, damage: 2.4 }), cannon: Object.freeze({ period: 57, damage: 9.6 }) }),
});

export interface VolleyResult {
  aircraft: Aircraft;
  rounds: number;
  damage: number;
  poolBlocked: boolean;
}

/** Capacity is reserved for the entire volley before clocks or ammunition change. */
export function consumeAircraftVolley(aircraft: Aircraft, kind: AircraftWeapon, tick: number, freeSlots: number): VolleyResult {
  const ammo = kind === 'mg' ? 'machineGunAmmo' : 'cannonAmmo';
  const clock = kind === 'mg' ? 'nextMachineGunTick' : 'nextCannonTick';
  const result = { aircraft, rounds: 0, damage: 0, poolBlocked: false };
  if (aircraft.status !== 'active' || aircraft.hp <= 0 || aircraft.role === null
    || aircraft.reloadUntilTick !== null || aircraft[clock] > tick || aircraft[ammo] <= 0) return result;
  // A final odd round is emitted alone rather than stranded or rounded into new ammo.
  const rounds = Math.min(2, aircraft[ammo]);
  if (freeSlots < rounds) return { ...result, poolBlocked: true };
  const weapon = AIRCRAFT_WEAPONS[aircraft.role][kind];
  const next = { ...aircraft, [ammo]: aircraft[ammo] - rounds, [clock]: tick + weapon.period };
  if (next.machineGunAmmo === 0 && next.cannonAmmo === 0) next.reloadUntilTick = tick + AIRCRAFT_RELOAD_TICKS;
  return { aircraft: next, rounds, damage: weapon.damage, poolBlocked: false };
}

/** Tick deadlines remain on the mission clock, including for noncontrolled wing aircraft. */
export function updateReloads(mission: MissionState): MissionState {
  if (mission.phase !== 'playing' || mission.finalized) return mission;
  return {
    ...mission,
    aircraft: mission.aircraft.map(aircraft => {
      if (aircraft.status !== 'active' || aircraft.hp <= 0) return aircraft;
      if (aircraft.reloadUntilTick !== null && aircraft.reloadUntilTick <= mission.tick) {
        return { ...aircraft, machineGunAmmo: MACHINE_GUN_CAPACITY, cannonAmmo: CANNON_CAPACITY, reloadUntilTick: null };
      }
      if (aircraft.reloadUntilTick === null && aircraft.machineGunAmmo === 0 && aircraft.cannonAmmo === 0) {
        return { ...aircraft, reloadUntilTick: mission.tick + AIRCRAFT_RELOAD_TICKS };
      }
      return aircraft;
    }),
    enemies: mission.enemies.map(enemy => {
      if (enemy.status !== 'active' || enemy.hp <= 0) return enemy;
      if (enemy.reloadUntilTick !== null && enemy.reloadUntilTick <= mission.tick) {
        return { ...enemy, ammunition: 12, reloadUntilTick: null };
      }
      if (enemy.reloadUntilTick === null && enemy.ammunition === 0) {
        return { ...enemy, reloadUntilTick: mission.tick + ENEMY_RELOAD_TICKS, attackTargetId: null };
      }
      return enemy;
    }),
    ships: mission.ships.map(ship => {
      if (ship.status !== 'alive' || ship.hp <= 0) return ship;
      if (ship.reloadUntilTick !== null && ship.reloadUntilTick <= mission.tick) {
        return { ...ship, ammunition: 6, reloadUntilTick: null };
      }
      if (ship.reloadUntilTick === null && ship.ammunition === 0) {
        return { ...ship, reloadUntilTick: mission.tick + SHIP_RELOAD_TICKS, ownsAttackSlot: false };
      }
      return ship;
    }),
  };
}

export function consumeMagicRound(enemy: Enemy, tick: number): Enemy {
  const ammunition = enemy.ammunition - 1;
  return {
    ...enemy, ammunition, nextFireTick: tick + 15,
    nextMagicType: enemy.nextMagicType === 'fire' ? 'ice' : 'fire',
    reloadUntilTick: ammunition === 0 ? tick + ENEMY_RELOAD_TICKS : enemy.reloadUntilTick,
    attackTargetId: ammunition === 0 ? null : enemy.attackTargetId,
  };
}

export function consumeShipRound(ship: Ship, tick: number): Ship {
  const ammunition = ship.ammunition - 1;
  return {
    ...ship, ammunition, nextFireTick: tick + 60,
    reloadUntilTick: ammunition === 0 ? tick + SHIP_RELOAD_TICKS : ship.reloadUntilTick,
    ownsAttackSlot: ammunition > 0,
  };
}
