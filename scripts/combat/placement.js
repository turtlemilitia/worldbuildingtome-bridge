// Pure helpers for putting a Tome combat onto a Foundry scene. No Foundry
// globals: callers pass plain data, so these are unit-tested directly.

/**
 * @typedef {{ id: string, uuid: string, name: string, type: string }} ActorRef
 * @typedef {{ id: string, actorId: string | null, x: number, y: number, width: number, height: number, dead: boolean, inCombat: boolean }} TokenRef
 */

const normalise = (name) => String(name ?? '').trim().toLowerCase();

/**
 * Match a planned combatant to a world actor: by uuid first, then by name
 * (uuids differ between worlds; names travel).
 *
 * @param {{ foundry_uuid?: string | null, name: string }} combatant
 * @param {ActorRef[]} actors
 * @returns {ActorRef | null}
 */
export function resolveActor(combatant, actors) {
  if (combatant.foundry_uuid) {
    const byUuid = actors.find((actor) => actor.uuid === combatant.foundry_uuid);
    if (byUuid) {
      return byUuid;
    }
  }

  const wanted = normalise(combatant.name);
  const stripped = wanted.replace(/\s+[a-z]{1,2}$/, '');

  return actors.find((actor) => normalise(actor.name) === wanted)
    ?? actors.find((actor) => normalise(actor.name) === stripped)
    ?? null;
}

/**
 * Reuse tokens already on the scene before creating any: a player's own token,
 * or for a monster, free tokens of that actor nearest the view. Dead tokens and
 * tokens already fighting are never reused.
 *
 * @param {Array<{ key: string | number, actorId: string }>} wanted
 * @param {TokenRef[]} tokens
 * @param {{ x: number, y: number }} [near]
 * @returns {{ reuse: Map<string | number, string>, shortfall: Array<string | number> }}
 */
export function matchTokens(wanted, tokens, near = { x: 0, y: 0 }) {
  const taken = new Set();
  const reuse = new Map();
  const shortfall = [];
  const distance = (t) => Math.hypot(t.x - near.x, t.y - near.y);

  for (const request of wanted) {
    const candidate = tokens
      .filter((t) => t.actorId === request.actorId && !t.dead && !t.inCombat && !taken.has(t.id))
      .sort((a, b) => distance(a) - distance(b))[0];

    if (candidate) {
      taken.add(candidate.id);
      reuse.set(request.key, candidate.id);
    } else {
      shortfall.push(request.key);
    }
  }

  return { reuse, shortfall };
}

/**
 * Free grid cells spiralling out from the centre of the view, skipping
 * anything already occupied, so new tokens land in one tidy group.
 *
 * @param {{ x: number, y: number }} centre  snapped top-left of the centre cell
 * @param {number} size  grid size in pixels
 * @param {Array<{ x: number, y: number, width: number, height: number }>} occupied  in pixels
 * @param {number} count
 * @returns {Array<{ x: number, y: number }>}
 */
export function gridSlots(centre, size, occupied, count) {
  const isFree = (x, y) => !occupied.some((o) => x < o.x + o.width && x + size > o.x && y < o.y + o.height && y + size > o.y);
  const slots = [];

  for (let ring = 0; slots.length < count && ring < 50; ring++) {
    for (let dy = -ring; dy <= ring && slots.length < count; dy++) {
      for (let dx = -ring; dx <= ring && slots.length < count; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) {
          continue;
        }
        const x = centre.x + dx * size;
        const y = centre.y + dy * size;
        if (isFree(x, y)) {
          slots.push({ x, y });
          occupied = [...occupied, { x, y, width: size, height: size }];
        }
      }
    }
  }

  return slots;
}
