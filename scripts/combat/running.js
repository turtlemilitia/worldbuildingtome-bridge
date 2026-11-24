// Reports the combats Foundry is running, so the Tome can pick one up
// mid-fight ("Import from Foundry"). Same pattern as playlists.js.

import { api } from '../api.js';

const MODULE_ID = 'worldbuildingtome-bridge';
const LOG_PREFIX = '[WBT]';
const REPORT_DEBOUNCE_MS = 1000;

/**
 * @param {any} combat
 */
export function describeCombat(combat) {
  return {
    id: combat.id,
    scene: combat.scene?.name ?? null,
    round: combat.round,
    linked: Boolean(combat.flags?.[MODULE_ID]?.combatId),
    currentCombatantId: combat.combatant?.id ?? null,
    combatants: combat.combatants.contents.map((c) => {
      const actor = c.actor;
      const hp = actor?.system?.attributes?.hp ?? {};
      const toInt = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
      return {
        id: c.id,
        name: c.name,
        tokenId: c.tokenId ?? null,
        actorUuid: c.token?.baseActor?.uuid ?? actor?.uuid ?? null,
        isPlayer: actor?.type === 'character',
        initiative: c.initiative ?? null,
        hp: toInt(hp.value),
        maxHp: toInt(hp.max),
        temp: toInt(hp.temp) ?? 0,
        ac: toInt(actor?.system?.attributes?.ac?.value),
        defeated: Boolean(c.isDefeated ?? c.defeated),
        hidden: Boolean(c.hidden),
        statuses: Array.from(actor?.statuses ?? []),
      };
    }),
  };
}

export async function reportRunningCombats() {
  const combats = (globalThis.game?.combats?.contents ?? []).filter((c) => c.started);
  await api('foundry-connections/me/running-combats', {
    method: 'POST',
    body: { combats: combats.slice(0, 20).map(describeCombat) },
  });
}

/**
 * @returns {() => void}
 */
export function watchRunningCombats() {
  let timer = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      reportRunningCombats().catch((err) => console.warn(`${LOG_PREFIX} running-combat report failed:`, err));
    }, REPORT_DEBOUNCE_MS);
  };

  const hookNames = [
    'createCombat', 'updateCombat', 'deleteCombat',
    'createCombatant', 'updateCombatant', 'deleteCombatant',
    'updateActor', 'createActiveEffect', 'deleteActiveEffect',
  ];
  const registered = hookNames.map((name) => [name, Hooks.on(name, schedule)]);
  return () => registered.forEach(([name, id]) => Hooks.off(name, id));
}
