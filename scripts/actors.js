// Reports the world's actors to the Tome, the way playlists.js reports
// playlists. Foundry owns the stats; the Tome keeps a read-only copy so the GM
// can plan encounters and see statblocks without Foundry in front of them.
//
// Two steps keep it cheap: a manifest of {uuid, fingerprint} tells the API what
// it already has, and only the stale actors are rendered and sent in full.

import { api, ApiError } from './api.js';

const LOG_PREFIX = '[WBT]';
const REPORT_DEBOUNCE_MS = 2000;
const BATCH_SIZE = 25;
const REPORTED_TYPES = ['character', 'npc'];

/** Bump when the shape of what we send changes, so every actor is resent once. */
export const PAYLOAD_VERSION = 3;

/**
 * @param {any} actor
 * @returns {boolean}
 */
export function isReportable(actor) {
  return Boolean(actor) && REPORTED_TYPES.includes(actor.type) && !actor.isToken;
}

/**
 * Changes whenever anything that shows up in the statblock could have changed,
 * without having to render it.
 *
 * @param {any} actor
 * @param {string} systemVersion
 * @returns {string}
 */
export function actorFingerprint(actor, systemVersion) {
  const items = Array.from(actor.items ?? []);
  const effects = Array.from(actor.effects ?? []);
  const newest = [actor, ...items, ...effects]
    .map((doc) => Number(doc?._stats?.modifiedTime ?? 0))
    .reduce((max, time) => Math.max(max, time), 0);

  return [PAYLOAD_VERSION, systemVersion, newest, items.length, effects.length].join(':');
}

/**
 * @param {any} actor
 * @param {{ formatCR?: (cr: number) => string, sizeLabel?: (size: string) => string | undefined, origin?: string }} [helpers]
 */
export function summarise(actor, helpers = {}) {
  const system = actor.system ?? {};
  const attributes = system.attributes ?? {};
  const details = system.details ?? {};
  const cr = typeof details.cr === 'number' ? details.cr : null;
  const creatureType = details.type?.label ?? details.type?.value ?? null;
  const size = system.traits?.size ? helpers.sizeLabel?.(system.traits.size) : undefined;

  return {
    subtitle: [size, creatureType].filter(Boolean).join(' ') || null,
    cr: cr === null ? null : (helpers.formatCR?.(cr) ?? String(cr)),
    creatureType: creatureType || null,
    ac: toInt(attributes.ac?.value),
    hpMax: toInt(attributes.hp?.max),
    initiativeBonus: toInt(attributes.init?.total ?? attributes.init?.mod),
    folder: actor.folder?.name ?? null,
    img: actor.img ? absoluteUrl(actor.img, helpers.origin) : null,
    traits: traits(actor),
  };
}

const REGENERATION = /regenerat/i;
const SUNLIGHT = /sunlight (hyper)?sensitivity|vampire weakness/i;
const REGAINS = /regains\s+(\d+)\s+hit points/i;

/**
 * The handful of statblock features the Tome's tracker reminds the GM about
 * at the start of a turn. Read from dnd5e's data; the full text stays in the
 * statblock HTML.
 *
 * @param {any} actor
 */
export function traits(actor) {
  const items = Array.from(actor.items ?? []);
  const text = (item) => stripTags(item.system?.description?.value ?? '');

  const regenItem = items.find((item) => REGENERATION.test(item.name ?? ''));
  const regenAmount = regenItem ? Number(text(regenItem).match(REGAINS)?.[1]) : NaN;
  const legendary = Number(actor.system?.resources?.legact?.max ?? 0);

  return {
    regeneration: Number.isFinite(regenAmount) && regenAmount > 0 ? regenAmount : null,
    sunlight: items.some((item) => SUNLIGHT.test(item.name ?? '') || /sunlight (hyper)?sensitivity/i.test(text(item))),
    legendary: legendary > 0 ? legendary : null,
    lair: Boolean(actor.system?.resources?.lair?.value),
    recharge: items
      .map((item) => ({ item, recharge: rechargeOf(item) }))
      .filter(({ recharge }) => recharge !== null)
      .map(({ item, recharge }) => ({ key: item.id, name: String(item.name ?? '').replace(/\s*\(recharge.*\)$/i, ''), on: recharge })),
  };
}

function rechargeOf(item) {
  const recovery = item.system?.uses?.recovery;
  const entries = Array.isArray(recovery) ? recovery : Array.from(recovery ?? []);
  const entry = entries.find((r) => r?.period === 'recharge');
  if (!entry) {
    return null;
  }
  const from = Number(entry.formula);
  return Number.isFinite(from) && from < 6 ? `${from}–6` : '6';
}

function stripTags(html) {
  return String(html).replace(/<[^>]*>/g, ' ');
}

/**
 * dnd5e renders NPC statblocks itself (`NPCData#toEmbed`), so the Tome shows
 * exactly what the sheet shows. PCs have no statblock embed.
 *
 * @param {any} actor
 * @returns {Promise<string | null>}
 */
export async function statblockHtml(actor) {
  if (actor.type !== 'npc' || typeof actor.system?.toEmbed !== 'function') {
    return null;
  }

  try {
    const fragment = await actor.system.toEmbed({ values: ['statblock'] });
    if (!fragment) {
      return null;
    }
    const container = document.createElement('div');
    container.append(fragment);
    return container.innerHTML.trim() || null;
  } catch (err) {
    console.warn(`${LOG_PREFIX} could not render a statblock for "${actor.name}":`, err);
    return null;
  }
}

/**
 * @param {any} actor
 * @param {string} systemVersion
 * @param {Parameters<typeof summarise>[1]} helpers
 */
export async function actorPayload(actor, systemVersion, helpers) {
  return {
    uuid: actor.uuid,
    name: String(actor.name ?? '').trim() || 'Unnamed',
    type: actor.type,
    // dnd5e keeps player characters as `character` actors; ownership isn't a
    // reliable signal (a prep world often has no player accounts yet).
    isPlayer: actor.type === 'character',
    fingerprint: actorFingerprint(actor, systemVersion),
    summary: summarise(actor, helpers),
    statblockHtml: await statblockHtml(actor),
  };
}

/**
 * @template T
 * @param {T[]} list
 * @param {number} size
 * @returns {T[][]}
 */
export function chunk(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size));
  }
  return chunks;
}

/**
 * @param {{ actors?: any[], systemVersion?: string, helpers?: Parameters<typeof summarise>[1], request?: typeof api, yieldFn?: () => Promise<void> }} [options]
 * @returns {Promise<{ sent: number }>}
 */
export async function reportActors({
  actors = Array.from(globalThis.game?.actors ?? []),
  systemVersion = String(globalThis.game?.system?.version ?? ''),
  helpers = foundryHelpers(),
  request = api,
  yieldFn = idle,
} = {}) {
  const reportable = actors.filter(isReportable);
  const manifest = reportable.map((actor) => ({ uuid: actor.uuid, fingerprint: actorFingerprint(actor, systemVersion) }));

  const { stale = [] } = (await request('foundry-connections/me/actors/sync', { method: 'POST', body: { actors: manifest } })) ?? {};
  const staleSet = new Set(stale);
  const toSend = reportable.filter((actor) => staleSet.has(actor.uuid));

  for (const batch of chunk(toSend, BATCH_SIZE)) {
    const payload = [];
    for (const actor of batch) {
      payload.push(await actorPayload(actor, systemVersion, helpers));
    }
    await request('foundry-connections/me/actors', { method: 'POST', body: { actors: payload } });
    await yieldFn();
  }

  return { sent: toSend.length };
}

/**
 * Re-sync whenever an actor, its items or its effects change. Debounced so an
 * import of fifty monsters collapses into one sync.
 *
 * @returns {() => void}
 */
export function watchActors() {
  let timer = null;

  const schedule = (document) => {
    const actor = document?.documentName === 'Actor' ? document : document?.parent;
    if (actor && actor.documentName === 'Actor' && !isReportable(actor)) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      runReport();
    }, REPORT_DEBOUNCE_MS);
  };

  const hookNames = [
    'createActor', 'updateActor', 'deleteActor',
    'createItem', 'updateItem', 'deleteItem',
    'createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect',
  ];
  const registered = hookNames.map((name) => [name, Hooks.on(name, schedule)]);

  return () => registered.forEach(([name, id]) => Hooks.off(name, id));
}

export function runReport() {
  return reportActors().catch((err) => {
    if (err instanceof ApiError && err.status === 404) {
      console.warn(`${LOG_PREFIX} this Tome doesn't accept actor reports yet.`);
      return;
    }
    console.warn(`${LOG_PREFIX} actor report failed:`, err);
  });
}

function foundryHelpers() {
  const dnd5e = globalThis.dnd5e;
  return {
    formatCR: dnd5e?.utils?.formatCR,
    sizeLabel: (size) => {
      const entry = globalThis.CONFIG?.DND5E?.actorSizes?.[size];
      return typeof entry === 'string' ? entry : entry?.label;
    },
    origin: globalThis.window?.location?.origin,
  };
}

function idle() {
  return new Promise((resolve) => {
    if (typeof globalThis.requestIdleCallback === 'function') {
      globalThis.requestIdleCallback(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function toInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function absoluteUrl(path, origin) {
  try {
    return new URL(path, origin ?? 'http://localhost').href;
  } catch {
    return null;
  }
}
