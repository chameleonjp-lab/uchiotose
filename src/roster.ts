/** P1: deterministic finite rosters. These reducers never mutate their input. */
export const RULES_VERSION = 'uchiotose-1';
export const TICKS_PER_SECOND = 60;
export const AIRCRAFT_TOTAL = 50;
export const ENEMY_TOTAL = 100;
export const SHIP_TOTAL = 10;
export const AIRCRAFT_CAPACITY = 8;
export const ENEMY_CAPACITY = 24;
export const AIRCRAFT_RESPAWN_TICKS = 3 * TICKS_PER_SECOND;
export const ENEMY_RESPAWN_TICKS = 2 * TICKS_PER_SECOND;

export type AircraftId = `A${string}`;
export type EnemyId = `E${string}`;
export type ShipId = `S${string}`;
export type MissionPhase = 'loading' | 'home' | 'playing' | 'paused' | 'result';
export type AircraftRole = 'player' | 'wing';
export type RosterOutcome = 'victory' | 'defeat';

export interface Reservation<Id extends string> {
  missionId: string;
  entityId: Id;
  slot: number;
  dueTick: number;
}

/** Effect data is retained here; damage and expiry belong to P4. */
export interface BurnState {
  projectileId: string;
  startsAtSeconds: number;
  endsAtSeconds: number;
}

export interface IceState {
  startsAtTick: number;
  expiresAtTick: number;
}

export interface Aircraft {
  id: AircraftId;
  status: 'reserve' | 'pending' | 'active' | 'lost';
  role: AircraftRole | null;
  slot: number | null;
  reservation: Reservation<AircraftId> | null;
  hp: number;
  baseSpeedMps: number;
  actualSpeedMps: number;
  machineGunAmmo: number;
  cannonAmmo: number;
  reloadUntilTick: number | null;
  nextMachineGunTick: number;
  nextCannonTick: number;
  burns: BurnState[];
  ice: IceState | null;
  loopActive: boolean;
  loopProgress: number;
  loopCooldownUntilTick: number;
}

export interface Enemy {
  id: EnemyId;
  status: 'reserve' | 'pending' | 'active' | 'defeated';
  slot: number | null;
  reservation: Reservation<EnemyId> | null;
  hp: number;
  velocity: { x: number; y: number; z: number };
  ammunition: number;
  reloadUntilTick: number | null;
  nextFireTick: number;
  nextMagicType: 'fire' | 'ice';
  entering: boolean;
  attackTargetId: AircraftId | ShipId | null;
}

export interface Ship {
  id: ShipId;
  status: 'alive' | 'sunk';
  hp: number;
  routeRadiusM: number;
  routePhase: number;
  baseSpeedMps: number;
  actualSpeedMps: number;
  ammunition: number;
  reloadUntilTick: number | null;
  nextFireTick: number;
  ownsAttackSlot: boolean;
  burns: BurnState[];
  ice: IceState | null;
}

export interface LossTotals {
  player: number;
  wing: number;
  ships: number;
  enemies: number;
}

export interface MissionState {
  missionId: string;
  rulesVersion: string;
  seed: number;
  tick: number;
  phase: MissionPhase;
  finalized: boolean;
  aircraft: Aircraft[];
  enemies: Enemy[];
  ships: Ship[];
  controlledAircraftId: AircraftId | null;
  handoff: { aircraftId: AircraftId; atTick: number; missionId: string } | null;
  /** Consumers clear held input, camera interpolation and loop visuals on change. */
  controlResetVersion: number;
  /** Clear only after all keys and pointers have been released. */
  requiresInputRelease: boolean;
  losses: LossTotals;
  /** Finite-roster result only. Combat scoring and its snapshot belong to P5. */
  outcome: RosterOutcome | null;
}

export interface MissionOptions {
  missionId: string;
  seed?: number;
  phase?: 'loading' | 'home' | 'playing';
}

export interface DeathBatch {
  missionId: string;
  aircraftIds?: readonly AircraftId[];
  enemyIds?: readonly EnemyId[];
  shipIds?: readonly ShipId[];
}

export interface RosterCounts {
  aircraft: { reserve: number; pending: number; active: number; lost: number; remaining: number };
  enemies: { reserve: number; pending: number; active: number; defeated: number; remaining: number };
  ships: { alive: number; sunk: number };
}

function aircraftDefaults(id: AircraftId): Aircraft {
  return {
    id, status: 'reserve', role: null, slot: null, reservation: null, hp: 0,
    baseSpeedMps: 110, actualSpeedMps: 110,
    machineGunAmmo: 288, cannonAmmo: 96, reloadUntilTick: null,
    nextMachineGunTick: 0, nextCannonTick: 0,
    burns: [], ice: null, loopActive: false, loopProgress: 0, loopCooldownUntilTick: 0,
  };
}

function enemyDefaults(id: EnemyId): Enemy {
  return {
    id, status: 'reserve', slot: null, reservation: null, hp: 0,
    velocity: { x: 0, y: 0, z: 10 / 3.6 }, ammunition: 12,
    reloadUntilTick: null, nextFireTick: 0, nextMagicType: 'fire',
    entering: true, attackTargetId: null,
  };
}

function paddedId(prefix: string, index: number): string {
  return `${prefix}${String(index + 1).padStart(3, '0')}`;
}

export function createMissionState(options: MissionOptions): MissionState {
  if (!options.missionId.trim()) throw new Error('A nonempty missionId is required');
  const seed = options.seed ?? 1;
  if (!Number.isSafeInteger(seed)) throw new Error('seed must be a safe integer');
  const aircraft = Array.from({ length: AIRCRAFT_TOTAL }, (_, index) => {
    const item = aircraftDefaults(paddedId('A', index) as AircraftId);
    if (index < AIRCRAFT_CAPACITY) {
      item.status = 'active'; item.slot = index; item.hp = 80;
      item.role = index === 0 ? 'player' : 'wing';
    }
    return item;
  });
  const enemies = Array.from({ length: ENEMY_TOTAL }, (_, index) => {
    const item = enemyDefaults(paddedId('E', index) as EnemyId);
    if (index < ENEMY_CAPACITY) {
      item.status = 'active'; item.slot = index; item.hp = 80;
    }
    return item;
  });
  const state: MissionState = {
    missionId: options.missionId, rulesVersion: RULES_VERSION, seed,
    tick: 0, phase: options.phase ?? 'home', finalized: false,
    aircraft, enemies,
    ships: Array.from({ length: SHIP_TOTAL }, (_, index) => ({
      id: paddedId('S', index) as ShipId, status: 'alive', hp: 1200,
      routeRadiusM: 2000 + index * 100, routePhase: index * Math.PI * 2 / SHIP_TOTAL,
      baseSpeedMps: 6, actualSpeedMps: 6, ammunition: 6,
      reloadUntilTick: null, nextFireTick: 0, ownsAttackSlot: false, burns: [], ice: null,
    })),
    controlledAircraftId: 'A001', handoff: null,
    controlResetVersion: 1, requiresInputRelease: true,
    losses: { player: 0, wing: 0, ships: 0, enemies: 0 }, outcome: null,
  };
  assertRosterInvariants(state);
  return state;
}

function cloneMission(state: MissionState): MissionState {
  return {
    ...state,
    aircraft: state.aircraft.map(item => ({
      ...item, reservation: item.reservation && { ...item.reservation },
      burns: item.burns.map(effect => ({ ...effect })), ice: item.ice && { ...item.ice },
    })),
    enemies: state.enemies.map(item => ({
      ...item, reservation: item.reservation && { ...item.reservation }, velocity: { ...item.velocity },
    })),
    ships: state.ships.map(item => ({
      ...item, burns: item.burns.map(effect => ({ ...effect })), ice: item.ice && { ...item.ice },
    })),
    handoff: state.handoff && { ...state.handoff }, losses: { ...state.losses },
  };
}

export function resetMission(previous: MissionState, options: MissionOptions): MissionState {
  if (options.missionId === previous.missionId) throw new Error('A retry requires a fresh missionId');
  const state = createMissionState({ seed: previous.seed, phase: 'playing', ...options });
  state.controlResetVersion = previous.controlResetVersion + 1;
  return state;
}

/** Starting from Home uses resetMission with a fresh ID; only Pause resumes a mission. */
export function setMissionPhase(state: MissionState, phase: 'home' | 'paused' | 'playing'): MissionState {
  if (phase === state.phase) return state;
  if (phase === 'playing' && (state.phase !== 'paused' || state.finalized)) {
    throw new Error('Only a paused mission can resume; start a fresh mission from Home');
  }
  if (phase === 'paused' && state.phase !== 'playing') return state;
  const next = cloneMission(state);
  next.phase = phase;
  next.controlResetVersion += 1;
  next.requiresInputRelease = true;
  return next;
}

export function acknowledgeInputRelease(state: MissionState, missionId: string, resetVersion: number): MissionState {
  if (state.finalized || missionId !== state.missionId || resetVersion !== state.controlResetVersion || !state.requiresInputRelease) return state;
  return { ...state, requiresInputRelease: false };
}

export function getRosterCounts(state: MissionState): RosterCounts {
  const aircraft = { reserve: 0, pending: 0, active: 0, lost: 0, remaining: 0 };
  const enemies = { reserve: 0, pending: 0, active: 0, defeated: 0, remaining: 0 };
  const ships = { alive: 0, sunk: 0 };
  for (const item of state.aircraft) aircraft[item.status] += 1;
  for (const item of state.enemies) enemies[item.status] += 1;
  for (const item of state.ships) ships[item.status] += 1;
  aircraft.remaining = AIRCRAFT_TOTAL - aircraft.lost;
  enemies.remaining = ENEMY_TOTAL - enemies.defeated;
  return { aircraft, enemies, ships };
}

export function getRosterOutcome(state: MissionState): RosterOutcome | null {
  const counts = getRosterCounts(state);
  if (counts.aircraft.remaining === 0 || counts.ships.alive === 0) return 'defeat';
  if (counts.enemies.remaining === 0) return 'victory';
  return null;
}

function changeControl(state: MissionState, id: AircraftId | null): void {
  if (state.controlledAircraftId === id) return;
  state.controlledAircraftId = id;
  state.controlResetVersion += 1;
  state.requiresInputRelease = true;
  if (id) {
    const aircraft = state.aircraft.find(item => item.id === id)!;
    aircraft.loopActive = false;
    aircraft.loopProgress = 0;
  }
}

function byId<T extends { id: string }>(items: T[]): T[] {
  return items.slice().sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function reserveAircraft(state: MissionState, aircraft: Aircraft, slot: number): void {
  aircraft.status = 'pending'; aircraft.slot = slot;
  aircraft.role = slot === 0 ? 'player' : 'wing';
  aircraft.reservation = {
    missionId: state.missionId, entityId: aircraft.id, slot,
    dueTick: state.tick + AIRCRAFT_RESPAWN_TICKS,
  };
}

/** Priority: existing player reservation, unused reserve, wing reservation, living wing. */
function ensurePlayer(state: MissionState, atTickStart: boolean): void {
  if (state.controlledAircraftId) { state.handoff = null; return; }
  if (state.aircraft.some(item => item.status === 'pending' && item.slot === 0)) {
    state.handoff = null; return;
  }
  const reserve = byId(state.aircraft.filter(item => item.status === 'reserve'))[0];
  if (reserve) { reserveAircraft(state, reserve, 0); state.handoff = null; return; }
  const pending = byId(state.aircraft.filter(item => item.status === 'pending'))[0];
  if (pending) {
    pending.slot = 0; pending.role = 'player'; pending.reservation!.slot = 0;
    state.handoff = null; return;
  }
  const wing = byId(state.aircraft.filter(item => item.status === 'active'))[0];
  if (!wing) { state.handoff = null; return; }
  if (atTickStart && state.handoff && state.handoff.atTick <= state.tick) {
    wing.slot = 0; wing.role = 'player'; changeControl(state, wing.id);
    state.handoff = null;
  } else {
    state.handoff = { aircraftId: wing.id, atTick: state.tick + 1, missionId: state.missionId };
  }
}

function scheduleVacancies(state: MissionState): void {
  ensurePlayer(state, false);
  const occupiedAircraftSlots = new Set(state.aircraft
    .filter(item => item.status === 'active' || item.status === 'pending').map(item => item.slot));
  const aircraftReserve = byId(state.aircraft.filter(item => item.status === 'reserve'));
  for (let slot = 1; slot < AIRCRAFT_CAPACITY; slot += 1) {
    if (occupiedAircraftSlots.has(slot)) continue;
    const aircraft = aircraftReserve.shift();
    if (!aircraft) break;
    reserveAircraft(state, aircraft, slot);
  }
  const occupiedEnemySlots = new Set(state.enemies
    .filter(item => item.status === 'active' || item.status === 'pending').map(item => item.slot));
  const enemyReserve = byId(state.enemies.filter(item => item.status === 'reserve'));
  for (let slot = 0; slot < ENEMY_CAPACITY; slot += 1) {
    if (occupiedEnemySlots.has(slot)) continue;
    const enemy = enemyReserve.shift();
    if (!enemy) break;
    enemy.status = 'pending'; enemy.slot = slot;
    enemy.reservation = {
      missionId: state.missionId, entityId: enemy.id, slot,
      dueTick: state.tick + ENEMY_RESPAWN_TICKS,
    };
  }
}

/** A due wing fills a missing player before spawning; swap any later player reservation. */
function prioritizeReadyPlayer(state: MissionState): void {
  if (state.controlledAircraftId) return;
  const player = state.aircraft.find(item => item.status === 'pending' && item.slot === 0);
  if (player && player.reservation!.dueTick <= state.tick) return;
  const ready = byId(state.aircraft.filter(item => item.status === 'pending'
    && item.reservation!.missionId === state.missionId && item.reservation!.dueTick <= state.tick))[0];
  if (!ready || ready.slot === 0) return;
  const wingSlot = ready.slot!;
  if (player) {
    player.slot = wingSlot; player.role = 'wing'; player.reservation!.slot = wingSlot;
  }
  ready.slot = 0; ready.role = 'player'; ready.reservation!.slot = 0;
  state.handoff = null;
}

function finalizeDeaths(state: MissionState, deaths: DeathBatch): void {
  const aircraftIds = new Set(deaths.aircraftIds);
  const enemyIds = new Set(deaths.enemyIds);
  const shipIds = new Set(deaths.shipIds);
  for (const aircraft of state.aircraft) {
    if (aircraft.status !== 'active' || (!aircraftIds.has(aircraft.id) && aircraft.hp > 0)) continue;
    state.losses[aircraft.role!] += 1;
    aircraft.status = 'lost'; aircraft.hp = 0; aircraft.slot = null; aircraft.reservation = null;
    aircraft.burns = []; aircraft.ice = null; aircraft.loopActive = false; aircraft.loopProgress = 0;
    if (state.controlledAircraftId === aircraft.id) changeControl(state, null);
  }
  for (const enemy of state.enemies) {
    if (enemy.status !== 'active' || (!enemyIds.has(enemy.id) && enemy.hp > 0)) continue;
    enemy.status = 'defeated'; enemy.hp = 0; enemy.slot = null; enemy.reservation = null;
    enemy.attackTargetId = null; state.losses.enemies += 1;
  }
  for (const ship of state.ships) {
    if (ship.status !== 'alive' || (!shipIds.has(ship.id) && ship.hp > 0)) continue;
    ship.status = 'sunk'; ship.hp = 0; ship.ownsAttackSlot = false;
    ship.burns = []; ship.ice = null; state.losses.ships += 1;
  }
}

function finalizeIfTerminal(state: MissionState): boolean {
  const outcome = getRosterOutcome(state);
  if (!outcome) return false;
  state.outcome = outcome; state.phase = 'result'; state.finalized = true; state.handoff = null;
  state.requiresInputRelease = true; state.controlResetVersion += 1;
  return true;
}

/** One mission-clock boundary. Paused/Home/result never advance reservation deadlines. */
export function beginMissionTick(state: MissionState): MissionState {
  if (state.phase !== 'playing' || state.finalized) return state;
  const next = cloneMission(state);
  next.tick += 1;
  // Recheck a candidate that died before control transfer; classify its old wing role first.
  finalizeDeaths(next, { missionId: next.missionId });
  if (!finalizeIfTerminal(next)) {
    ensurePlayer(next, true);
    prioritizeReadyPlayer(next);
    const readyAircraft = byId(next.aircraft.filter(item => item.status === 'pending'))
      .sort((left, right) => Number(right.slot === 0) - Number(left.slot === 0));
    for (const aircraft of readyAircraft) {
      const reservation = aircraft.reservation!;
      if (reservation.missionId !== next.missionId || reservation.dueTick > next.tick) continue;
      const { slot } = reservation;
      Object.assign(aircraft, aircraftDefaults(aircraft.id), {
        status: 'active', hp: 80, slot, role: slot === 0 ? 'player' : 'wing',
        nextMachineGunTick: next.tick, nextCannonTick: next.tick,
      });
      if (slot === 0) changeControl(next, aircraft.id);
    }
    for (const enemy of byId(next.enemies.filter(item => item.status === 'pending'))) {
      const reservation = enemy.reservation!;
      if (reservation.missionId !== next.missionId || reservation.dueTick > next.tick) continue;
      Object.assign(enemy, enemyDefaults(enemy.id), {
        status: 'active', hp: 80, slot: reservation.slot, nextFireTick: next.tick,
      });
    }
    scheduleVacancies(next);
  }
  assertRosterInvariants(next);
  return next;
}

/** Call after collecting the tick's complete set of collision/damage deaths. */
export function completeMissionTick(state: MissionState, deaths: DeathBatch): MissionState {
  if (state.phase !== 'playing' || state.finalized || deaths.missionId !== state.missionId) return state;
  const next = cloneMission(state);
  finalizeDeaths(next, deaths);
  // Losses of every faction are committed before the result or any new reservation.
  if (!finalizeIfTerminal(next)) scheduleVacancies(next);
  assertRosterInvariants(next);
  return next;
}

/** P1-only convenience step; a future combat step runs between these two boundaries. */
export function advanceMissionTick(state: MissionState, deaths: DeathBatch = { missionId: state.missionId }): MissionState {
  if (deaths.missionId !== state.missionId) return state;
  return completeMissionTick(beginMissionTick(state), deaths);
}

export function assertRosterInvariants(state: MissionState): void {
  function require(condition: boolean, message: string): void {
    if (!condition) throw new Error(`Roster invariant: ${message}`);
  }
  require(Number.isSafeInteger(state.tick) && state.tick >= 0, 'nonnegative integer tick');
  function checkRoster<Id extends string>(
    items: { id: Id; status: string; slot: number | null; reservation: Reservation<Id> | null; hp: number }[],
    prefix: string, total: number, capacity: number, terminal: string,
  ): void {
    require(items.length === total, `${prefix} total`);
    const ids = new Set(items.map(item => item.id));
    const slots = new Set<number>();
    require(ids.size === total, `${prefix} unique identifiers`);
    for (let index = 0; index < total; index += 1) require(ids.has(paddedId(prefix, index) as Id), `${prefix} fixed identifiers`);
    for (const item of items) {
      require(['reserve', 'pending', 'active', terminal].includes(item.status), `${item.id} exclusive status`);
      require(Number.isFinite(item.hp) && item.hp >= 0 && item.hp <= 80, `${item.id} HP range`);
      if (item.status === 'active' || item.status === 'pending') {
        require(item.slot !== null && Number.isInteger(item.slot) && item.slot >= 0 && item.slot < capacity, `${item.id} valid slot`);
        require(!slots.has(item.slot!), `${item.id} unique slot`); slots.add(item.slot!);
      } else {
        require(item.slot === null && item.reservation === null && item.hp === 0, `${item.id} inactive resources`);
      }
      if (item.status === 'pending') {
        const reservation = item.reservation;
        require(Boolean(reservation && reservation.missionId === state.missionId && reservation.entityId === item.id
          && reservation.slot === item.slot && Number.isSafeInteger(reservation.dueTick) && reservation.dueTick >= 0), `${item.id} valid reservation`);
        require(item.hp === 0, `${item.id} unspawned HP`);
      } else require(item.reservation === null, `${item.id} pending-only reservation`);
      if (item.status === 'active') require(item.hp > 0, `${item.id} living active`);
    }
    require(slots.size <= capacity, `${prefix} capacity`);
  }
  checkRoster(state.aircraft, 'A', AIRCRAFT_TOTAL, AIRCRAFT_CAPACITY, 'lost');
  checkRoster(state.enemies, 'E', ENEMY_TOTAL, ENEMY_CAPACITY, 'defeated');
  const controlled = state.aircraft.filter(item => item.status === 'active' && item.role === 'player');
  require(controlled.length <= 1, 'one controlled aircraft');
  require((controlled[0]?.id ?? null) === state.controlledAircraftId, 'controlled ID owns player role');
  for (const aircraft of state.aircraft) {
    if (aircraft.status === 'active' || aircraft.status === 'pending') {
      require(aircraft.role === (aircraft.slot === 0 ? 'player' : 'wing'), `${aircraft.id} role matches slot`);
    }
    if (aircraft.status === 'reserve') require(aircraft.role === null, `${aircraft.id} unused role`);
    if (aircraft.status === 'lost') require(aircraft.role === 'player' || aircraft.role === 'wing', `${aircraft.id} loss role`);
  }
  require(state.ships.length === SHIP_TOTAL && new Set(state.ships.map(item => item.id)).size === SHIP_TOTAL, 'ship total and unique IDs');
  for (let index = 0; index < SHIP_TOTAL; index += 1) require(state.ships.some(item => item.id === paddedId('S', index)), 'fixed ship IDs');
  for (const ship of state.ships) {
    require(ship.status === 'alive' || ship.status === 'sunk', `${ship.id} exclusive status`);
    require(Number.isFinite(ship.hp) && ship.hp >= 0 && ship.hp <= 1200 && (ship.status === 'alive' ? ship.hp > 0 : ship.hp === 0), `${ship.id} HP range`);
  }
  const counts = getRosterCounts(state);
  require(state.losses.player === state.aircraft.filter(item => item.status === 'lost' && item.role === 'player').length, 'player losses once');
  require(state.losses.wing === state.aircraft.filter(item => item.status === 'lost' && item.role === 'wing').length, 'wing losses once');
  require(state.losses.enemies === counts.enemies.defeated && state.losses.ships === counts.ships.sunk, 'enemy and ship losses once');
  if (state.handoff) {
    require(state.controlledAircraftId === null && state.handoff.missionId === state.missionId, 'handoff ownership');
    require(Number.isSafeInteger(state.handoff.atTick) && state.handoff.atTick > state.tick, 'next-tick handoff');
    require(state.aircraft.some(item => item.id === state.handoff!.aircraftId && item.status === 'active'), 'living handoff candidate');
  }
  if (state.phase === 'playing' && counts.aircraft.remaining > 0 && !state.controlledAircraftId) {
    require(state.aircraft.some(item => item.status === 'pending' && item.slot === 0) || state.handoff !== null, 'finite control wait');
  }
  require(!state.finalized || state.outcome !== null, 'finalized outcome');
  require(state.outcome === null || state.finalized, 'terminal outcome finalized');
}
