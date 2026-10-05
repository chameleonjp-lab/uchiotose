export interface AttackOwner { ownerId: string; targetId: string }
export interface AttackCandidate { id: string; targetIds: readonly string[] }
export interface AttackTarget { id: string; kind: 'aircraft' | 'ship' }
export interface ShotBudget { period: number; remaining: number }
export interface AttackBudgetState {
  enemyOwners: AttackOwner[];
  shipOwners: AttackOwner[];
  enemyCursor: number;
  shipCursor: number;
  aircraftTargetCursor: number;
  shipTargetCursor: number;
  preferTargetKind: 'aircraft' | 'ship';
  rotationPeriod: number;
  enemyBudget: ShotBudget;
  shipBudget: ShotBudget;
}

export function createAttackBudget(): AttackBudgetState {
  return {
    enemyOwners: [], shipOwners: [], enemyCursor: 0, shipCursor: 0,
    aircraftTargetCursor: 0, shipTargetCursor: 0, preferTargetKind: 'aircraft', rotationPeriod: -1,
    enemyBudget: { period: -1, remaining: 0 }, shipBudget: { period: -1, remaining: 0 },
  };
}

export function refreshShotBudget(previous: ShotBudget, tick: number, periodTicks: number, capacity: number): ShotBudget {
  const period = Math.floor((tick - 1) / periodTicks);
  return previous.period === period ? { ...previous } : { period, remaining: capacity };
}

/** Rotate through fixed ID slots, even when eligibility temporarily changes. */
function roundRobin<T>(items: readonly T[], cursor: number): T[] {
  return items.slice(cursor % Math.max(1, items.length)).concat(items.slice(0, cursor % Math.max(1, items.length)));
}

/** Assignment and the global shot budgets are deliberately independent. */
export function assignAttackSlots(
  previous: AttackBudgetState, tick: number,
  enemies: readonly AttackCandidate[], enemyIds: readonly string[], targets: readonly AttackTarget[],
  ships: readonly AttackCandidate[], shipIds: readonly string[],
): AttackBudgetState {
  const next: AttackBudgetState = {
    ...previous, enemyOwners: previous.enemyOwners.slice(), shipOwners: previous.shipOwners.slice(),
    enemyBudget: refreshShotBudget(previous.enemyBudget, tick, 15, 8),
    shipBudget: refreshShotBudget(previous.shipBudget, tick, 60, 4),
  };
  const rotationPeriod = Math.floor((tick - 1) / 120);
  if (rotationPeriod !== previous.rotationPeriod) {
    next.enemyOwners = []; next.shipOwners = []; next.rotationPeriod = rotationPeriod;
  }
  const enemyMap = new Map(enemies.map(candidate => [candidate.id, candidate]));
  const shipMap = new Map(ships.map(candidate => [candidate.id, candidate]));
  next.enemyOwners = next.enemyOwners.filter(owner => enemyMap.get(owner.ownerId)?.targetIds.includes(owner.targetId));
  next.shipOwners = next.shipOwners.filter(owner => shipMap.get(owner.ownerId)?.targetIds.includes(owner.targetId));
  const targetCounts = new Map<string, number>();
  for (const owner of next.enemyOwners) targetCounts.set(owner.targetId, (targetCounts.get(owner.targetId) ?? 0) + 1);
  const aircraftTargets = targets.filter(target => target.kind === 'aircraft').map(target => target.id).sort();
  const shipTargets = targets.filter(target => target.kind === 'ship').map(target => target.id).sort();
  for (const id of roundRobin(enemyIds.slice().sort(), next.enemyCursor)) {
    if (next.enemyOwners.length >= 8) break;
    const candidate = enemyMap.get(id);
    if (!candidate || next.enemyOwners.some(owner => owner.ownerId === id)) continue;
    const preferred = next.preferTargetKind;
    let chosen: string | null = null;
    for (const kind of [preferred, preferred === 'aircraft' ? 'ship' : 'aircraft'] as const) {
      const list = kind === 'aircraft' ? aircraftTargets : shipTargets;
      const cursorKey = kind === 'aircraft' ? 'aircraftTargetCursor' : 'shipTargetCursor';
      for (const targetId of roundRobin(list, next[cursorKey])) {
        if (!candidate.targetIds.includes(targetId) || (targetCounts.get(targetId) ?? 0) >= 2) continue;
        chosen = targetId; next[cursorKey] = (list.indexOf(targetId) + 1) % list.length;
        next.preferTargetKind = kind === 'aircraft' ? 'ship' : 'aircraft';
        break;
      }
      if (chosen) break;
    }
    if (!chosen) continue;
    next.enemyOwners.push({ ownerId: id, targetId: chosen });
    targetCounts.set(chosen, (targetCounts.get(chosen) ?? 0) + 1);
    next.enemyCursor = (enemyIds.slice().sort().indexOf(id) + 1) % enemyIds.length;
  }
  for (const id of roundRobin(shipIds.slice().sort(), next.shipCursor)) {
    if (next.shipOwners.length >= 4) break;
    const candidate = shipMap.get(id);
    if (!candidate?.targetIds.length || next.shipOwners.some(owner => owner.ownerId === id)) continue;
    next.shipOwners.push({ ownerId: id, targetId: candidate.targetIds[0] });
    next.shipCursor = (shipIds.slice().sort().indexOf(id) + 1) % shipIds.length;
  }
  next.enemyOwners.sort((left, right) => left.ownerId.localeCompare(right.ownerId));
  next.shipOwners.sort((left, right) => left.ownerId.localeCompare(right.ownerId));
  return next;
}
