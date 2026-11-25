import { describe, expect, it, vi } from 'vitest';
import {
  actorFingerprint,
  actorPayload,
  chunk,
  droppedFeatures,
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

/**
 * A dnd5e feat item: `activation` is its first activity's activation type,
 * `undefined` meaning it has no activities at all.
 */
function feature({ id, name, sort = 0, trait = false, activation, type = 'feat', identifier, uses, description = `<p>${name}.</p>` }) {
  const activities = activation === undefined ? [] : [{ activation: { type: activation }, uses: { label: '' } }];
  return {
    id,
    name,
    sort,
    type,
    identifier: identifier ?? name.toLowerCase().replace(/\W+/g, '-'),
    system: {
      properties: new Set(trait ? ['trait'] : []),
      activities: { contents: activities, size: activities.length },
      uses: { label: uses ?? '' },
      description: { value: description },
    },
  };
}

const EMBED_WITHOUT_TRAITS = '<div class="statblock npc rules-2024"><h4 class="statblock-title">Count Caer Ddu</h4>'
  + '<div class="statblock-content"><div class="statblock-header"></div>'
  + '<div class="statblock-actions action"><h5 class="statblock-actions-title">Actions</h5>'
  + '<div class="statblock-action" data-id="multi"><p><span class="name">Multiattack</span> Three strikes.</p></div>'
  + '</div></div></div>';

/** The homebrew Umbral Lord whose blank/"special" activations dnd5e's embed drops. */
function countCaerDdu({ embed = EMBED_WITHOUT_TRAITS, items, extraItems = [] } = {}) {
  const all = items ?? [
    feature({ id: 'multi', name: 'Multiattack', sort: 100, activation: 'action' }),
    feature({ id: 'legres', name: 'Legendary Resistance', sort: 200, activation: 'special', uses: '3/Day' }),
    feature({ id: 'escape', name: 'Shadow Escape', sort: 300, activation: '' }),
    feature({
      id: 'weakness',
      name: 'Vampire Weakness',
      sort: 400,
      activation: '',
      description: '<p class="feature">The vampire takes [[/damage 20 radiant]] damage in sunlight.</p><p class="feature-trait">Running water hurts.</p>',
    }),
    feature({ id: 'strike', name: 'Umbral Strike', sort: 500, activation: 'legendary' }),
    feature({ id: 'legact', name: 'Legendary Actions', sort: 600, identifier: 'legendary-actions' }),
    { id: 'hadar', name: 'Hunger of Hadar', type: 'spell', system: { properties: new Set(), activities: { contents: [{ activation: { type: '' } }], size: 1 } } },
  ];

  return npc({
    name: 'Count Caer Ddu',
    items: [...all, ...extraItems],
    system: {
      ...npc().system,
      toEmbed: async () => {
        const template = document.createElement('template');
        template.innerHTML = embed;
        return template.content;
      },
    },
  });
}

const fakeEnrich = async (html) => html.replace(/\[\[\/damage [^\]]+]]/g, '<b>enriched</b>');

function parse(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

function names(section) {
  return Array.from(section.querySelectorAll('.statblock-action > .name, .statblock-action > p > .name'))
    .map((name) => name.textContent);
}

describe('droppedFeatures', () => {
  it('picks exactly the features dnd5e\'s embed has no section for', () => {
    expect(droppedFeatures(countCaerDdu()).map((item) => item.name))
      .toEqual(['Legendary Resistance', 'Shadow Escape', 'Vampire Weakness']);
  });

  it('keeps features flagged as traits or with no activities, as dnd5e files those under Traits', () => {
    const actor = countCaerDdu({
      items: [
        feature({ id: 'a', name: 'Vampire Weakness', activation: '', trait: true }),
        feature({ id: 'b', name: 'Undead Nature' }),
        feature({ id: 'c', name: 'Sunlight Hypersensitivity', activation: '' }),
        feature({ id: 'd', name: 'Bite', type: 'weapon', activation: 'special' }),
      ],
    });

    expect(droppedFeatures(actor).map((item) => item.name)).toEqual(['Sunlight Hypersensitivity', 'Bite']);
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

  it('files features the embed dropped under a new Traits section, ahead of Actions', async () => {
    const actor = countCaerDdu();

    const html = await statblockHtml(actor, { enrich: fakeEnrich });

    const root = parse(html);
    const sections = Array.from(root.querySelectorAll('.statblock-content > .statblock-actions'));
    expect(sections.map((section) => section.className)).toEqual(['statblock-actions trait', 'statblock-actions action']);
    expect(sections[0].querySelector('.statblock-actions-title').textContent).toBe('Traits');
    expect(names(sections[0])).toEqual(['Legendary Resistance (3/Day)', 'Shadow Escape', 'Vampire Weakness']);
    expect(names(sections[1])).toEqual(['Multiattack']);
  });

  it('keeps dnd5e\'s feature markup, with the name run into the enriched first paragraph', async () => {
    const html = await statblockHtml(countCaerDdu(), { enrich: fakeEnrich });

    const weakness = parse(html).querySelector('.statblock-action[data-id="weakness"]');
    expect(weakness.innerHTML).toBe(
      '<p class="feature"><span class="name">Vampire Weakness</span> The vampire takes <b>enriched</b> damage in sunlight.</p>'
      + '<p class="feature-trait">Running water hurts.</p>',
    );
  });

  it('slots dropped features into an existing Traits section by sort order', async () => {
    const actor = countCaerDdu({
      embed: '<div class="statblock npc rules-2024"><div class="statblock-content">'
        + '<div class="statblock-actions trait"><h5 class="statblock-actions-title">Traits</h5>'
        + '<div class="statblock-action" data-id="climb"><span class="name">Spider Climb</span></div></div>'
        + '<div class="statblock-actions action"><div class="statblock-action" data-id="multi"><span class="name">Multiattack</span></div></div>'
        + '</div></div>',
      extraItems: [feature({ id: 'climb', name: 'Spider Climb', sort: 250, trait: true })],
    });

    const html = await statblockHtml(actor, { enrich: fakeEnrich });

    const traits = parse(html).querySelector('.statblock-actions.trait');
    expect(traits.querySelectorAll('.statblock-actions-title')).toHaveLength(1);
    expect(names(traits)).toEqual(['Legendary Resistance (3/Day)', 'Spider Climb', 'Shadow Escape', 'Vampire Weakness']);
  });

  it('leaves the heading off a 2014 statblock, as dnd5e does', async () => {
    const actor = countCaerDdu({ embed: EMBED_WITHOUT_TRAITS.replace('rules-2024', 'rules-2014') });

    const html = await statblockHtml(actor, { enrich: fakeEnrich });

    const traits = parse(html).querySelector('.statblock-actions.trait');
    expect(traits.querySelector('.statblock-actions-title')).toBeNull();
    expect(names(traits)).toHaveLength(3);
  });

  it('leaves the embed untouched when nothing was dropped', async () => {
    const actor = countCaerDdu({ items: [feature({ id: 'multi', name: 'Multiattack', activation: 'action' })] });
    const enrich = vi.fn(fakeEnrich);

    expect(await statblockHtml(actor, { enrich })).toBe(EMBED_WITHOUT_TRAITS);
    expect(enrich).not.toHaveBeenCalled();
  });

  it('treats a feature name as text, not markup', async () => {
    const actor = countCaerDdu({ items: [feature({ id: 'x', name: '<img src=x onerror=alert(1)>', activation: '', description: '<p>Hides.</p>' })] });

    const html = await statblockHtml(actor, { enrich: fakeEnrich });

    expect(html).not.toContain('<img');
    expect(parse(html).querySelector('.statblock-action[data-id="x"] .name').textContent).toBe('<img src=x onerror=alert(1)>');
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
