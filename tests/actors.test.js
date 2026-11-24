import { describe, expect, it, vi } from 'vitest';
import {
  actorFingerprint,
  actorPayload,
  chunk,
  isReportable,
  PAYLOAD_VERSION,
  reportActors,
  statblockHtml,
  summarise,
  traits,
} from '../scripts/actors.js';

const stamp = (modifiedTime) => ({ _stats: { modifiedTime } });

function npc(overrides = {}) {
  return {
    uuid: 'Actor.spawn',
    name: 'Vampire Spawn',
    type: 'npc',
    isToken: false,
    hasPlayerOwner: false,
    img: 'systems/dnd5e/tokens/undead/VampireSpawn.webp',
    folder: { name: 'Crypt' },
    items: [stamp(200), stamp(150)],
    effects: [],
    system: {
      attributes: { ac: { value: 16 }, hp: { max: 90 }, init: { total: 3 } },
      details: { cr: 5, type: { label: 'Undead' } },
      traits: { size: 'med' },
    },
    ...stamp(100),
    ...overrides,
  };
}

describe('isReportable', () => {
  it('reports world characters and npcs only', () => {
    expect(isReportable(npc())).toBe(true);
    expect(isReportable(npc({ type: 'character' }))).toBe(true);
    expect(isReportable(npc({ type: 'vehicle' }))).toBe(false);
    expect(isReportable(npc({ isToken: true }))).toBe(false);
    expect(isReportable(null)).toBe(false);
  });
});

describe('actorFingerprint', () => {
  it('is stable for an unchanged actor', () => {
    expect(actorFingerprint(npc(), '5.3.3')).toBe(actorFingerprint(npc(), '5.3.3'));
  });

  it('changes when an item is edited, added or the system updates', () => {
    const base = actorFingerprint(npc(), '5.3.3');

    expect(actorFingerprint(npc({ items: [stamp(999), stamp(150)] }), '5.3.3')).not.toBe(base);
    expect(actorFingerprint(npc({ items: [stamp(200), stamp(150), stamp(10)] }), '5.3.3')).not.toBe(base);
    expect(actorFingerprint(npc({ effects: [stamp(1)] }), '5.3.3')).not.toBe(base);
    expect(actorFingerprint(npc(), '5.4.0')).not.toBe(base);
  });

  it('carries the payload version so a format change resends everything', () => {
    expect(actorFingerprint(npc(), '5.3.3').startsWith(`${PAYLOAD_VERSION}:`)).toBe(true);
  });
});

describe('summarise', () => {
  it('reads dnd5e stats into the summary', () => {
    const summary = summarise(npc(), {
      formatCR: (cr) => `CR${cr}`,
      sizeLabel: () => 'Medium',
      origin: 'http://localhost:30000',
    });

    expect(summary).toEqual({
      subtitle: 'Medium Undead',
      cr: 'CR5',
      creatureType: 'Undead',
      ac: 16,
      hpMax: 90,
      initiativeBonus: 3,
      folder: 'Crypt',
      img: 'http://localhost:30000/systems/dnd5e/tokens/undead/VampireSpawn.webp',
      traits: { regeneration: null, sunlight: false, legendary: null, lair: false, recharge: [] },
    });
  });

  it('copes with an actor missing most data', () => {
    const summary = summarise({ type: 'character', system: {} });

    expect(summary).toMatchObject({ subtitle: null, cr: null, ac: null, hpMax: null, initiativeBonus: null, img: null });
  });
});

describe('traits', () => {
  it('reads regeneration, sunlight, legendary actions, lair and recharge from dnd5e data', () => {
    const actor = npc({
      items: [
        { id: 'regen', name: 'Regeneration', system: { description: { value: '<p>The vampire regains 20 Hit Points at the start of its turn.</p>' } } },
        { id: 'sun', name: 'Sunlight Hypersensitivity', system: {} },
        { id: 'burst', name: 'Shadow Burst (Recharge 5–6)', system: { uses: { recovery: [{ period: 'recharge', formula: '5' }] } } },
        { id: 'claw', name: 'Claw', system: { uses: { recovery: [] } } },
      ],
      system: { ...npc().system, resources: { legact: { max: 3 }, lair: { value: true } } },
    });

    expect(traits(actor)).toEqual({
      regeneration: 20,
      sunlight: true,
      legendary: 3,
      lair: true,
      recharge: [{ key: 'burst', name: 'Shadow Burst', on: '5–6' }],
    });
  });

  it('spots sunlight from the 2024 "Vampire Weakness" trait and from description text', () => {
    expect(traits(npc({ items: [{ id: 'w', name: 'Vampire Weakness', system: {} }] })).sunlight).toBe(true);
    expect(traits(npc({ items: [{ id: 'w', name: 'Weaknesses', system: { description: { value: '<p><em>Sunlight Hypersensitivity.</em> Takes 20 radiant.</p>' } } }] })).sunlight).toBe(true);
  });

  it('finds nothing on a plain creature', () => {
    expect(traits(npc({ items: [] }))).toEqual({ regeneration: null, sunlight: false, legendary: null, lair: false, recharge: [] });
  });
});

describe('statblockHtml', () => {
  it('serialises the dnd5e embed fragment', async () => {
    const actor = npc({
      system: {
        ...npc().system,
        toEmbed: async () => {
          const template = document.createElement('template');
          template.innerHTML = '<div class="statblock npc"><p>Claw</p></div>';
          return template.content;
        },
      },
    });

    expect(await statblockHtml(actor)).toBe('<div class="statblock npc"><p>Claw</p></div>');
  });

  it('returns null for characters and for failed renders', async () => {
    expect(await statblockHtml(npc({ type: 'character' }))).toBeNull();

    const broken = npc({ system: { ...npc().system, toEmbed: async () => { throw new Error('boom'); } } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await statblockHtml(broken)).toBeNull();
  });
});

describe('actorPayload', () => {
  it('marks every character as a player, owned or not', async () => {
    const payload = await actorPayload(npc({ type: 'character', hasPlayerOwner: false, name: ' Thalia ' }), '5.3.3', {});

    expect(payload).toMatchObject({ uuid: 'Actor.spawn', name: 'Thalia', type: 'character', isPlayer: true, statblockHtml: null });
  });

  it('never marks an npc as a player, even when a player owns it', async () => {
    const payload = await actorPayload(npc({ hasPlayerOwner: true }), '5.3.3', {});

    expect(payload.isPlayer).toBe(false);
  });
});

describe('chunk', () => {
  it('splits into batches of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 25)).toEqual([]);
  });
});

describe('reportActors', () => {
  it('sends the manifest, then only the stale actors in batches of 25', async () => {
    const actors = Array.from({ length: 30 }, (_, i) => npc({ uuid: `Actor.${i}`, name: `Spawn ${i}` }));
    actors.push(npc({ uuid: 'Actor.cart', type: 'vehicle' }));
    const stale = actors.slice(0, 27).map((a) => a.uuid);

    const request = vi.fn(async (path) => (path.endsWith('/sync') ? { stale } : { stored: 0 }));

    const result = await reportActors({ actors, systemVersion: '5.3.3', helpers: {}, request, yieldFn: async () => {} });

    expect(result).toEqual({ sent: 27 });

    const [syncPath, syncOptions] = request.mock.calls[0];
    expect(syncPath).toBe('foundry-connections/me/actors/sync');
    expect(syncOptions.body.actors).toHaveLength(30);
    expect(syncOptions.body.actors.some((entry) => entry.uuid === 'Actor.cart')).toBe(false);

    const batches = request.mock.calls.slice(1).map(([, options]) => options.body.actors);
    expect(batches.map((batch) => batch.length)).toEqual([25, 2]);
    expect(batches.flat().map((actor) => actor.uuid)).toEqual(stale);
  });

  it('sends nothing more when nothing is stale', async () => {
    const request = vi.fn(async () => ({ stale: [] }));

    await reportActors({ actors: [npc()], systemVersion: '5.3.3', helpers: {}, request, yieldFn: async () => {} });

    expect(request).toHaveBeenCalledTimes(1);
  });
});
