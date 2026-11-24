// Mirrors a Tome combat into Foundry and reports Foundry-side changes back.
//
// The Tome is the referee for structure (who fights, order, turn, conditions)
// and Foundry owns live stats (HP, AC). Every change we make here carries
// `{ wbt: true }` in its options so our own hooks don't send it back.

import { api, ApiError } from '../api.js';
import { gridSlots, matchTokens, resolveActor } from './placement.js';
import { findMirrored, foundryInitiatives, isDown, planCombat, planConditions, revealedIds, turnCommandFor, unappliedOps } from './reconcile.js';

const MODULE_ID = 'worldbuildingtome-bridge';
const LOG_PREFIX = '[WBT]';
// Foundry writes into the options object it's given (parent, pack, …), so
// every call needs its own copy or the next one inherits the last's parent.
const origin = (extra = {}) => ({ wbt: true, ...extra });
const FREE_TEXT_ICON = 'icons/svg/aura.svg';

/** @type {Map<number, number>} Tome combat id → last version we synced */
const versions = new Map();
/** @type {Set<string>} pending Tome HP changes already applied here */
const appliedOps = new Set();
/**
 * `toggleStatusEffect` takes no options, so the effect it creates arrives in
 * our hooks untagged. Remember which ones we asked for so they aren't reported
 * back to the Tome as new.
 * @type {Set<string>}
 */
const ourStatuses = new Set();
let syncing = Promise.resolve();

const isActiveGM = () => Boolean(game.user?.isActiveGM ?? game.user?.isGM);
const flagOf = (doc, key) => doc?.getFlag?.(MODULE_ID, key) ?? doc?.flags?.[MODULE_ID]?.[key] ?? null;

/**
 * `combat-started`: put a new Tome combat onto the current scene.
 *
 * @param {{ combatId: number }} payload
 */
export async function onCombatStarted(payload) {
  if (!isActiveGM()) return;
  await queue(() => syncCombat(payload.combatId, { placeNew: true }));
}

/**
 * `combat-changed`: the Tome moved on; bring Foundry in line.
 *
 * @param {{ combatId: number, version: number }} payload
 */
export async function onCombatChanged(payload) {
  if (!isActiveGM()) return;
  if ((versions.get(payload.combatId) ?? 0) >= payload.version) return;
  await queue(() => syncCombat(payload.combatId, { placeNew: false }));
}

/**
 * `combat-deleted`: the Tome combat is gone, so its Foundry copy goes too.
 *
 * @param {{ combatId: number, foundryCombatId: string|null }} payload
 */
export async function onCombatDeleted(payload) {
  if (!isActiveGM()) return;
  await queue(async () => {
    versions.delete(payload.combatId);
    const combat = findMirrored(game.combats ?? [], payload, (c) => flagOf(c, 'combatId'));
    if (combat) await combat.delete(origin());
  });
}

/**
 * On load, catch up with whatever the Tome is running for this world.
 */
export async function syncActiveCombat() {
  if (!isActiveGM()) return;
  const { data } = (await api('foundry-connections/me/combats/active')) ?? {};
  if (data) {
    await queue(() => applyState(data, { placeNew: true }));
  }
}

function queue(task) {
  syncing = syncing.then(task).catch((err) => {
    console.error(`${LOG_PREFIX} combat sync failed:`, err);
    ui.notifications?.error(`World Building Tome: combat sync failed — ${err.message || err}`);
  });
  return syncing;
}

async function syncCombat(combatId, options) {
  const { data } = await api(`foundry-connections/me/combats/${combatId}`);
  await applyState(data, options);
}

/**
 * @param {any} state  the Tome's combat resource
 */
async function applyState(state, { placeNew }) {
  versions.set(state.id, state.version);

  let combat = state.foundry_combat_id ? game.combats.get(state.foundry_combat_id) : null;

  if (state.status === 'ended') {
    if (combat) await combat.delete(origin());
    return;
  }

  if (!combat) {
    // Deleted here on purpose: wait for the GM to send it back from the Tome.
    if (state.foundry_detached) return;
    if (!placeNew && !state.combatants.length) return;
    combat = await placeCombat(state, state.combatants);
    if (!combat) return;
    state = (await api(`foundry-connections/me/combats/${state.id}`)).data;
    versions.set(state.id, state.version);
  }

  await adoptCombat(state, combat);

  const plan = planCombat(state, snapshot(combat));

  if (plan.missing.length) {
    await placeCombat(state, plan.missing, combat);
    state = (await api(`foundry-connections/me/combats/${state.id}`)).data;
    versions.set(state.id, state.version);
  }

  const refreshed = planCombat(state, snapshot(combat));
  if (refreshed.deletes.length) {
    await combat.deleteEmbeddedDocuments('Combatant', refreshed.deletes, origin());
  }
  if (refreshed.updates.length) {
    await combat.updateEmbeddedDocuments('Combatant', refreshed.updates, origin());
    await revealTokens(combat, revealedIds(refreshed.updates));
  }
  if (refreshed.turn) {
    combat.setupTurns();
    const turn = combat.turns.findIndex((c) => c.id === refreshed.turn.combatantId);
    if (turn >= 0) {
      await combat.update({ round: refreshed.turn.round, turn }, origin({ direction: refreshed.turn.round >= combat.round ? 1 : -1 }));
    }
  }

  for (const tomeCombatant of state.combatants) {
    const combatant = tomeCombatant.foundry_combatant_id ? combat.combatants.get(tomeCombatant.foundry_combatant_id) : null;
    const actor = combatant?.actor;
    if (!actor) continue;
    await applyPendingHp(state, tomeCombatant, actor);
    await applyConditions(tomeCombatant, actor);
  }
}

/**
 * Showing a combatant from the Tome means players should see it, so its
 * token on the scene is revealed too, not just its tracker entry.
 */
async function revealTokens(combat, combatantIds) {
  for (const id of combatantIds) {
    const token = combat.combatants.get(id)?.token;
    if (token?.hidden) await token.update({ hidden: false }, origin());
  }
}

/**
 * A combat imported from Foundry, or added to, doesn't carry our flags yet;
 * without them the hooks can't tell which Tome combatant a change belongs to.
 */
async function adoptCombat(state, combat) {
  if (tomeCombatIdOf(combat) !== state.id) {
    await combat.update({ [`flags.${MODULE_ID}.combatId`]: state.id }, origin());
  }
  const updates = state.combatants
    .filter((c) => c.foundry_combatant_id && combat.combatants.get(c.foundry_combatant_id) && tomeIdOf(combat.combatants.get(c.foundry_combatant_id)) !== c.id)
    .map((c) => ({ _id: c.foundry_combatant_id, [`flags.${MODULE_ID}.tomeId`]: c.id }));
  if (updates.length) {
    await combat.updateEmbeddedDocuments('Combatant', updates, origin());
  }
}

function snapshot(combat) {
  return {
    round: combat.round,
    turnCombatantId: combat.combatant?.id ?? null,
    combatants: combat.combatants.map((c) => ({
      id: c.id,
      initiative: c.initiative,
      hidden: c.hidden,
      defeated: c.defeated,
    })),
  };
}

/**
 * Put Tome combatants onto the scene in view: reuse free tokens of the same
 * actor, place the rest in a tidy group (monsters hidden, players visible),
 * skip actors this world doesn't have, then report the ids back.
 */
async function placeCombat(state, combatants, existing = null) {
  const scene = canvas?.scene;
  if (!scene) {
    ui.notifications?.error('World Building Tome: open a scene first, then start the combat again.');
    return null;
  }

  let combat = existing;
  if (!combat) {
    combat = await chooseCombat(scene, state);
    if (!combat) return null;
  }

  const actors = game.actors.contents.map((a) => ({ id: a.id, uuid: a.uuid, name: a.name, type: a.type }));
  const skipped = [];
  const wanted = [];
  const lairs = [];

  for (const c of combatants) {
    // Only Foundry actors get tokens; the lair and anything typed in by hand
    // join the Foundry combat by name alone.
    if (c.kind === 'lair' || !c.foundry_uuid) {
      lairs.push(c);
      continue;
    }
    const actor = resolveActor(c, actors);
    if (!actor) {
      skipped.push(c.name);
      continue;
    }
    wanted.push({ key: c.id, actorId: actor.id, combatant: c, actor });
  }

  const centre = viewCentre();
  const tokens = scene.tokens.contents.map((t) => ({
    id: t.id,
    actorId: t.actorId,
    x: t.x,
    y: t.y,
    width: t.width * scene.grid.size,
    height: t.height * scene.grid.size,
    dead: Boolean(t.actor?.statuses?.has?.('dead')),
    inCombat: game.combats.some((cbt) => cbt.combatants.some((cb) => cb.tokenId === t.id)),
  }));

  const { reuse, shortfall } = matchTokens(wanted, tokens, centre);
  const slots = gridSlots(centre, scene.grid.size, tokens, shortfall.length);

  const created = [];
  for (const [index, key] of shortfall.entries()) {
    const request = wanted.find((w) => w.key === key);
    const actor = game.actors.get(request.actorId);
    const isPlayer = request.combatant.kind === 'pc';
    const slot = slots[index] ?? centre;
    const tokenDoc = await actor.getTokenDocument({ x: slot.x, y: slot.y, hidden: !isPlayer });
    created.push({ key, data: tokenDoc.toObject() });
  }

  const newTokens = created.length
    ? await scene.createEmbeddedDocuments('Token', created.map((c) => c.data), origin())
    : [];
  newTokens.forEach((token, index) => reuse.set(created[index].key, token.id));

  const initiatives = foundryInitiatives(state);
  const combatantData = [
    ...wanted.filter((w) => reuse.has(w.key)).map((w) => ({
      tokenId: reuse.get(w.key),
      sceneId: scene.id,
      name: w.combatant.name,
      actorId: w.actorId,
      hidden: Boolean(w.combatant.hidden) || w.combatant.kind !== 'pc' && newTokens.some((t) => t.id === reuse.get(w.key)),
      initiative: initiatives.get(w.combatant.id) ?? null,
      flags: { [MODULE_ID]: { tomeId: w.combatant.id } },
    })),
    ...lairs.map((c) => ({
      name: c.name,
      initiative: initiatives.get(c.id) ?? null,
      flags: { [MODULE_ID]: { tomeId: c.id } },
    })),
  ];

  const foundryCombatants = combatantData.length
    ? await combat.createEmbeddedDocuments('Combatant', combatantData, origin())
    : [];

  await api(`foundry-connections/me/combats/${state.id}/link`, {
    method: 'POST',
    body: {
      foundryCombatId: combat.id,
      combatants: foundryCombatants.map((fc) => ({
        id: flagOf(fc, 'tomeId'),
        foundryCombatantId: fc.id,
        foundryTokenId: fc.tokenId ?? null,
        foundryUuid: fc.token?.baseActor?.uuid ?? fc.actor?.uuid ?? null,
      })),
    },
  });

  if (newTokens.length) {
    canvas.tokens?.releaseAll?.();
    newTokens.forEach((t) => t.object?.control?.({ releaseOthers: false }));
  }

  const hiddenCount = newTokens.filter((t) => t.hidden).length;
  const parts = [];
  if (newTokens.length) parts.push(`Placed ${newTokens.length} token${newTokens.length === 1 ? '' : 's'} near your view${hiddenCount ? ` (${hiddenCount} hidden)` : ''} — drag them into place${hiddenCount ? ' and reveal' : ''}.`);
  const reused = reuse.size - newTokens.length;
  if (reused > 0) parts.push(`Reused ${reused} already on the scene.`);
  if (skipped.length) parts.push(`Skipped (not in this world): ${skipped.join(', ')}.`);
  if (parts.length) ui.notifications?.info(`World Building Tome: ${parts.join(' ')}`);

  return combat;
}

/**
 * A combat is already running on this scene: add to it, or start fresh?
 */
async function chooseCombat(scene, state) {
  const Combat = getDocumentClass('Combat');
  const createNew = () => Combat.create(
    { scene: scene.id, active: true, flags: { [MODULE_ID]: { combatId: state.id } } },
    origin(),
  );

  const running = game.combats.find((c) => c.scene?.id === scene.id && !flagOf(c, 'combatId'));
  if (!running) return createNew();

  const DialogV2 = foundry.applications.api.DialogV2;
  const choice = await DialogV2.wait({
    window: { title: 'World Building Tome' },
    content: `<p>A combat is already running on <strong>${foundry.utils.escapeHTML?.(scene.name) ?? scene.name}</strong>. Add “${foundry.utils.escapeHTML?.(state.name) ?? state.name}” to it, or start a new one?</p>`,
    buttons: [
      { action: 'add', label: 'Add to it', default: true },
      { action: 'new', label: 'Start a new combat' },
      { action: 'cancel', label: 'Cancel' },
    ],
    rejectClose: false,
  });

  if (choice === 'add') {
    await running.setFlag(MODULE_ID, 'combatId', state.id);
    return running;
  }
  if (choice === 'new') return createNew();
  return null;
}

function viewCentre() {
  const pivot = canvas.stage?.pivot ?? { x: 0, y: 0 };
  const snapped = canvas.grid?.getSnappedPoint?.({ x: pivot.x, y: pivot.y }, { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX });
  return snapped ?? { x: pivot.x, y: pivot.y };
}

async function applyPendingHp(state, tomeCombatant, actor) {
  const ops = unappliedOps(tomeCombatant.pending_hp, appliedOps);
  if (!ops.length) return;

  for (const op of ops) {
    appliedOps.add(op.id);
    if (op.mode === 'temp') {
      await actor.applyTempHP?.(op.amount);
    } else if (op.mode === 'heal') {
      await actor.applyDamage?.([{ value: op.amount, type: 'healing' }]);
    } else {
      await actor.applyDamage?.(op.type ? [{ value: op.amount, type: op.type.toLowerCase() }] : op.amount);
    }
  }

  await sendCommand(state.id, 'sync-stats', { combatantId: tomeCombatant.id, ...stats(actor), acknowledged: ops.map((op) => op.id) });
}

async function applyConditions(tomeCombatant, actor) {
  const known = new Set((CONFIG.statusEffects ?? []).map((s) => s.id));
  const effects = actor.effects.map((e) => ({
    id: e.id,
    statuses: Array.from(e.statuses ?? []),
    conditionId: flagOf(e, 'conditionId'),
  }));
  const plan = planConditions(tomeCombatant.conditions ?? [], effects, known);

  if (plan.remove.length) {
    await actor.deleteEmbeddedDocuments('ActiveEffect', plan.remove, origin());
  }
  for (const { effectId, conditionId } of plan.adopt) {
    await actor.effects.get(effectId)?.update({ [`flags.${MODULE_ID}.conditionId`]: conditionId }, origin());
  }
  for (const { status, conditionId } of plan.enable) {
    ourStatuses.add(`${actor.uuid}|${status}`);
    const effect = await actor.toggleStatusEffect(status, { active: true });
    if (effect && effect !== true) {
      await effect.update({ [`flags.${MODULE_ID}.conditionId`]: conditionId }, origin());
    }
  }
  if (plan.create.length) {
    await actor.createEmbeddedDocuments('ActiveEffect', plan.create.map((c) => ({
      name: c.name,
      img: FREE_TEXT_ICON,
      flags: { [MODULE_ID]: { conditionId: c.conditionId } },
    })), origin());
  }
}

function stats(actor) {
  const attributes = actor.system?.attributes ?? {};
  const toInt = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
  return {
    hp: toInt(attributes.hp?.value),
    maxHp: toInt(attributes.hp?.max),
    temp: toInt(attributes.hp?.temp) ?? 0,
    ac: toInt(attributes.ac?.value),
  };
}

async function sendCommand(combatId, command, payload, baseVersion) {
  try {
    const { data } = await api(`foundry-connections/me/combats/${combatId}/commands`, {
      method: 'POST',
      body: { command, payload, ...(baseVersion === undefined ? {} : { baseVersion }) },
    });
    if (data) versions.set(data.id, data.version);
    return data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      await queue(() => syncCombat(combatId, { placeNew: false }));
      return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Foundry → Tome
// ---------------------------------------------------------------------------

const tomeCombatIdOf = (combat) => flagOf(combat, 'combatId');
const tomeIdOf = (combatant) => flagOf(combatant, 'tomeId');

function combatantsForActor(actor) {
  const found = [];
  for (const combat of game.combats) {
    const combatId = tomeCombatIdOf(combat);
    if (!combatId) continue;
    for (const combatant of combat.combatants) {
      if (combatant.actor === actor && tomeIdOf(combatant)) {
        found.push({ combatId, tomeId: tomeIdOf(combatant) });
      }
    }
  }
  return found;
}

/**
 * Report Foundry-side edits made by the GM. Updates we made ourselves carry
 * `wbt` in their options and are skipped.
 *
 * @returns {() => void}
 */
export function watchCombat() {
  const handlers = {
    updateCombat(combat, changes, options) {
      if (options?.wbt || !isActiveGM()) return;
      const combatId = tomeCombatIdOf(combat);
      const command = turnCommandFor(changes, options);
      if (!combatId || !command) return;
      sendCommand(combatId, command, {}, versions.get(combatId)).catch(report);
    },
    updateCombatant(combatant, changes, options) {
      if (options?.wbt || !isActiveGM()) return;
      const combatId = tomeCombatIdOf(combatant.parent);
      const tomeId = tomeIdOf(combatant);
      if (!combatId || !tomeId) return;
      if ('initiative' in changes) {
        sendCommand(combatId, 'set-initiative', { combatantId: tomeId, initiative: changes.initiative }).catch(report);
      }
      if ('hidden' in changes) {
        sendCommand(combatId, 'set-hidden', { combatantId: tomeId, hidden: Boolean(changes.hidden) }).catch(report);
      }
    },
    deleteCombat(combat, options) {
      if (options?.wbt || !isActiveGM()) return;
      const combatId = tomeCombatIdOf(combat);
      if (!combatId) return;
      versions.delete(combatId);
      api(`foundry-connections/me/combats/${combatId}/unlink`, {
        method: 'POST',
        body: { foundryCombatId: combat.id },
      }).catch(report);
    },
    deleteCombatant(combatant, options) {
      if (options?.wbt || !isActiveGM()) return;
      const combatId = tomeCombatIdOf(combatant.parent);
      const tomeId = tomeIdOf(combatant);
      if (combatId && tomeId) {
        sendCommand(combatId, 'remove-combatant', { combatantId: tomeId }).catch(report);
      }
    },
    updateActor(actor, changes, options) {
      if (options?.wbt || !isActiveGM()) return;
      const touched = foundry.utils.getProperty(changes, 'system.attributes.hp') !== undefined
        || foundry.utils.getProperty(changes, 'system.attributes.ac') !== undefined;
      if (!touched) return;
      for (const { combatId, tomeId } of combatantsForActor(actor)) {
        sendCommand(combatId, 'sync-stats', { combatantId: tomeId, ...stats(actor) }).catch(report);
      }
    },
    createActiveEffect(effect, options) {
      if (options?.wbt || !isActiveGM() || flagOf(effect, 'conditionId')) return;
      const actor = effect.parent;
      const status = Array.from(effect.statuses ?? [])[0];
      if (!actor || !status) return;
      if (ourStatuses.delete(`${actor.uuid}|${status}`)) return;
      for (const { combatId, tomeId } of combatantsForActor(actor)) {
        sendCommand(combatId, 'add-condition', { combatantId: tomeId, name: effect.name, statusId: status, dur: { type: 'none' } }).catch(report);
      }
    },
    deleteActiveEffect(effect, options) {
      if (options?.wbt || !isActiveGM()) return;
      const conditionId = flagOf(effect, 'conditionId');
      const actor = effect.parent;
      if (!actor || !conditionId) return;
      for (const { combatId, tomeId } of combatantsForActor(actor)) {
        sendCommand(combatId, 'remove-condition', { combatantId: tomeId, conditionId, reason: 'removed in Foundry' }).catch(report);
      }
    },
  };

  const registered = Object.entries(handlers).map(([name, fn]) => [name, Hooks.on(name, fn)]);
  return () => registered.forEach(([name, id]) => Hooks.off(name, id));
}

function report(err) {
  console.warn(`${LOG_PREFIX} could not report a Foundry change to the Tome:`, err);
}

export { isDown };
