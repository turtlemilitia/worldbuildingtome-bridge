// Pure diffing between the Tome's combat (the referee for structure) and the
// Foundry combat that mirrors it. Produces the Foundry changes to make; the
// caller applies them with the origin tag so the hooks don't echo them back.

/**
 * Foundry sorts by initiative, then by id. The Tome breaks ties its own way
 * (lair last, higher bonus, who joined first) and puts followers straight
 * after their owner — so ties are spread by hundredths in Tome order, and
 * Foundry's tracker shows the same order.
 *
 * @param {{ order: number[], combatants: Array<{ id: number, initiative: number | null, follows_combatant_id: number | null }> }} state
 * @returns {Map<number, number | null>}
 */
export function foundryInitiatives(state) {
  const byId = new Map(state.combatants.map((c) => [c.id, c]));
  const effective = (c, depth = 0) => {
    const owner = c.follows_combatant_id ? byId.get(c.follows_combatant_id) : null;
    return owner && depth < 20 ? effective(owner, depth + 1) : c.initiative;
  };

  const seen = new Map();
  const out = new Map();
  for (const id of state.order) {
    const combatant = byId.get(id);
    if (!combatant) {
      continue;
    }
    const value = effective(combatant);
    if (value === null || value === undefined) {
      out.set(id, null);
      continue;
    }
    const key = String(value);
    const tieIndex = seen.get(key) ?? 0;
    seen.set(key, tieIndex + 1);
    out.set(id, Math.round((Number(value) - tieIndex * 0.01) * 100) / 100);
  }

  return out;
}

/**
 * @param {any} state  the Tome combat resource
 * @param {{ round: number, turnCombatantId: string | null, combatants: Array<{ id: string, initiative: number | null, hidden: boolean, defeated: boolean }> }} foundry
 */
export function planCombat(state, foundry) {
  const initiatives = foundryInitiatives(state);
  const foundryById = new Map(foundry.combatants.map((c) => [c.id, c]));
  const linkedIds = new Set();

  const updates = [];
  const missing = [];

  for (const combatant of state.combatants) {
    const fid = combatant.foundry_combatant_id;
    const mirror = fid ? foundryById.get(fid) : null;
    if (!mirror) {
      missing.push(combatant);
      continue;
    }
    linkedIds.add(fid);

    const change = { _id: fid };
    const initiative = initiatives.get(combatant.id) ?? null;
    if (!sameNumber(mirror.initiative, initiative)) change.initiative = initiative;
    if (Boolean(mirror.hidden) !== Boolean(combatant.hidden)) change.hidden = Boolean(combatant.hidden);
    const down = isDown(combatant);
    if (Boolean(mirror.defeated) !== down) change.defeated = down;
    if (Object.keys(change).length > 1) updates.push(change);
  }

  const deletes = foundry.combatants.filter((c) => !linkedIds.has(c.id)).map((c) => c.id);

  const current = state.combatants.find((c) => c.id === state.turn_combatant_id);
  const turn = state.status === 'active' && current?.foundry_combatant_id
    ? { round: state.round, combatantId: current.foundry_combatant_id }
    : null;
  const turnChanged = turn !== null && (turn.round !== foundry.round || turn.combatantId !== foundry.turnCombatantId);

  return { updates, deletes, missing, turn: turnChanged ? turn : null };
}

/**
 * The status icon a Tome condition maps to, if Foundry knows one.
 *
 * @param {{ name: string, status_id?: string | null }} condition
 * @param {Set<string>} knownStatuses
 */
export function statusFor(condition, knownStatuses) {
  if (condition.status_id && knownStatuses.has(condition.status_id)) {
    return condition.status_id;
  }
  const id = String(condition.name ?? '').trim().toLowerCase().replace(/\s+\d+$/, '');
  return knownStatuses.has(id) ? id : null;
}

/**
 * What to change on one actor so its effects match the Tome's conditions.
 * Effects the module created carry the Tome condition id; a status the GM
 * set in Foundry and the Tome has since recorded is adopted rather than
 * duplicated. Foundry-only statuses the Tome never heard of are left alone.
 *
 * @param {Array<{ id: string, name: string, status_id?: string | null }>} conditions
 * @param {Array<{ id: string, statuses: string[], conditionId: string | null }>} effects
 * @param {Set<string>} knownStatuses
 */
export function planConditions(conditions, effects, knownStatuses) {
  const wantedIds = new Set(conditions.map((c) => c.id));
  const enable = [];
  const create = [];
  const adopt = [];
  const remove = effects.filter((e) => e.conditionId && !wantedIds.has(e.conditionId)).map((e) => e.id);

  for (const condition of conditions) {
    if (effects.some((e) => e.conditionId === condition.id)) {
      continue;
    }
    const status = statusFor(condition, knownStatuses);
    const existing = status ? effects.find((e) => !e.conditionId && e.statuses.includes(status)) : null;
    if (existing) {
      adopt.push({ effectId: existing.id, conditionId: condition.id });
    } else if (status) {
      enable.push({ status, conditionId: condition.id });
    } else {
      create.push({ name: condition.name, conditionId: condition.id });
    }
  }

  return { enable, create, adopt, remove };
}

/**
 * HP changes made in the Tome that the module hasn't applied yet.
 *
 * @param {Array<{ id: string }>} pending
 * @param {Set<string>} applied
 */
export function unappliedOps(pending, applied) {
  return (pending ?? []).filter((op) => !applied.has(op.id));
}

export function isDown(combatant) {
  if (combatant.kind === 'pc' || combatant.kind === 'lair') {
    return false;
  }
  return Boolean(combatant.defeated) || (combatant.hp !== null && combatant.hp !== undefined && combatant.hp <= 0);
}

function sameNumber(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a ?? null) === (b ?? null);
  }
  return Math.abs(Number(a) - Number(b)) < 0.001;
}

/**
 * The Foundry combat mirroring a Tome combat: by the id the Tome recorded, or
 * by our flag when the link was never reported back.
 *
 * @template {{ id: string }} T
 * @param {Iterable<T>} combats
 * @param {{ combatId: number, foundryCombatId: string|null }} link
 * @param {(combat: T) => number|null} tomeIdOf
 * @returns {T|null}
 */
export function findMirrored(combats, { combatId, foundryCombatId }, tomeIdOf) {
  for (const combat of combats) {
    if ((foundryCombatId && combat.id === foundryCombatId) || tomeIdOf(combat) === combatId) {
      return combat;
    }
  }
  return null;
}

/**
 * The Tome command a GM's Foundry turn change stands for, or null. Foundry
 * also rewrites `turn` with `turnEvents: false` when it re-sorts (resetting
 * initiative) just to keep the same combatant current; that isn't a turn
 * change and reporting it would move the Tome on a step.
 *
 * @param {object} changes
 * @param {{ turnEvents?: boolean, direction?: number }} [options]
 * @returns {'advance' | 'back' | null}
 */
export function turnCommandFor(changes, options) {
  if (!('turn' in changes || 'round' in changes)) return null;
  if (options?.turnEvents === false && !('round' in changes)) return null;
  return (options?.direction ?? 1) < 0 ? 'back' : 'advance';
}

/**
 * The Foundry combatants a planned update takes out of hiding.
 *
 * @param {Array<{ _id: string, hidden?: boolean }>} updates
 * @returns {string[]}
 */
export function revealedIds(updates) {
  return updates.filter((u) => u.hidden === false).map((u) => u._id);
}
