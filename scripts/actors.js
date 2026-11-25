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
export const PAYLOAD_VERSION = 4;

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

const EMBED_SECTIONS = ['trait', 'action', 'bonus', 'reaction', 'legendary', 'mythic'];
const SECTION_DESCRIPTION_ITEMS = ['legendary-actions', 'mythic-actions'];

/**
 * Features dnd5e leaves out of its statblock embed. It files each feature
 * under its first activity's activation type unless it is flagged as a trait,
 * so a homebrew feature whose activation is blank or "special" matches no
 * section and silently disappears, though the sheet still shows it.
 *
 * @param {any} actor
 * @returns {any[]}
 */
export function droppedFeatures(actor) {
  return Array.from(actor.items ?? []).filter((item) => {
    if (!['feat', 'weapon'].includes(item.type) || SECTION_DESCRIPTION_ITEMS.includes(item.identifier)) {
      return false;
    }
    const category = item.system?.properties?.has?.('trait')
      ? 'trait'
      : (item.system?.activities?.contents?.[0]?.activation?.type ?? 'trait');
    return !EMBED_SECTIONS.includes(category);
  });
}

/**
 * dnd5e renders NPC statblocks itself (`NPCData#toEmbed`), so the Tome shows
 * exactly what the sheet shows, plus any features the embed dropped, filed
 * under traits. PCs have no statblock embed.
 *
 * @param {any} actor
 * @param {{ enrich?: (html: string, item: any) => Promise<string> }} [options]
 * @returns {Promise<string | null>}
 */
export async function statblockHtml(actor, { enrich = enrichDescription } = {}) {
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
    await restoreDroppedFeatures(container, actor, enrich);
    return container.innerHTML.trim() || null;
  } catch (err) {
    console.warn(`${LOG_PREFIX} could not render a statblock for "${actor.name}":`, err);
    return null;
  }
}

/**
 * @param {HTMLElement} container
 * @param {any} actor
 * @param {(html: string, item: any) => Promise<string>} enrich
 */
async function restoreDroppedFeatures(container, actor, enrich) {
  const dropped = droppedFeatures(actor);
  const content = container.querySelector('.statblock-content');
  if (!dropped.length || !content) {
    return;
  }

  const section = content.querySelector('.statblock-actions.trait') ?? createTraitSection(container, content);
  const sortOf = new Map(Array.from(actor.items ?? []).map((item) => [item.id, item.sort ?? 0]));

  for (const item of dropped) {
    const action = await featureElement(item, enrich);
    const sort = item.sort ?? 0;
    const next = childrenWithClass(section, 'statblock-action')
      .find((existing) => (sortOf.get(existing.dataset.id) ?? 0) > sort);
    section.insertBefore(action, next ?? null);
  }
}

/**
 * Mirrors dnd5e's `npc-embed.hbs` trait section: 2014 statblocks leave the
 * heading off, and traits come before every other section.
 *
 * @param {HTMLElement} container
 * @param {HTMLElement} content
 */
function createTraitSection(container, content) {
  const section = document.createElement('div');
  section.className = 'statblock-actions trait';
  if (!container.querySelector('.statblock.rules-2014')) {
    const title = document.createElement('h5');
    title.className = 'statblock-actions-title';
    title.textContent = localize('DND5E.NPC.SECTIONS.Traits', 'Traits');
    section.append(title);
  }
  content.insertBefore(section, childrenWithClass(content, 'statblock-actions')[0] ?? null);
  return section;
}

function childrenWithClass(parent, className) {
  return Array.from(parent.children).filter((child) => child.classList.contains(className));
}

/**
 * Same markup dnd5e gives a feature: the description's opening `<p>` is
 * hoisted so the name runs into the first paragraph.
 *
 * @param {any} item
 * @param {(html: string, item: any) => Promise<string>} enrich
 */
async function featureElement(item, enrich) {
  let description = await enrich(String(item.system?.description?.value ?? ''), item);
  const openingTag = description.match(/^\s*(<p(?:\s[^>]+)?>)/i)?.[0] ?? '';
  if (openingTag) {
    description = description.replace(openingTag, '');
  }

  const activities = item.system?.activities;
  const uses = item.system?.uses?.label
    || (activities?.size === 1 ? activities.contents[0]?.uses?.label : undefined);
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = uses ? `${item.name} (${uses})` : String(item.name ?? '');

  const action = document.createElement('div');
  action.className = 'statblock-action';
  action.dataset.id = item.id;
  action.innerHTML = `${openingTag}${name.outerHTML} ${description}`;
  return action;
}

function enrichDescription(html, item) {
  const TextEditor = globalThis.foundry?.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  return TextEditor.enrichHTML(html, { secrets: false, rollData: item.getRollData?.(), relativeTo: item });
}

function localize(key, fallback) {
  const text = globalThis.game?.i18n?.localize?.(key);
  return text && text !== key ? text : fallback;
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
