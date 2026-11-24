import { describe, expect, it } from 'vitest';
import { gridSlots, matchTokens, resolveActor } from '../scripts/combat/placement.js';

const actors = [
  { id: 'a1', uuid: 'Actor.a1', name: 'Vampire Spawn', type: 'npc' },
  { id: 'a2', uuid: 'Actor.a2', name: 'Thalia', type: 'character' },
];

describe('resolveActor', () => {
  it('prefers the uuid', () => {
    expect(resolveActor({ foundry_uuid: 'Actor.a2', name: 'Someone else' }, actors)?.id).toBe('a2');
  });

  it('falls back to the name, ignoring case and a letter suffix', () => {
    expect(resolveActor({ foundry_uuid: 'Actor.other-world', name: 'vampire spawn' }, actors)?.id).toBe('a1');
    expect(resolveActor({ name: 'Vampire Spawn B' }, actors)?.id).toBe('a1');
  });

  it('returns null for an actor the world does not have', () => {
    expect(resolveActor({ name: 'Owlbear' }, actors)).toBeNull();
  });
});

describe('matchTokens', () => {
  const token = (id, actorId, extra = {}) => ({ id, actorId, x: 0, y: 0, width: 100, height: 100, dead: false, inCombat: false, ...extra });

  it('reuses free tokens of the same actor, nearest first, and reports the shortfall', () => {
    const tokens = [
      token('far', 'a1', { x: 1000 }),
      token('near', 'a1', { x: 100 }),
      token('dead', 'a1', { dead: true }),
      token('busy', 'a1', { inCombat: true }),
    ];

    const { reuse, shortfall } = matchTokens(
      [{ key: 1, actorId: 'a1' }, { key: 2, actorId: 'a1' }, { key: 3, actorId: 'a1' }],
      tokens,
      { x: 0, y: 0 },
    );

    expect(reuse.get(1)).toBe('near');
    expect(reuse.get(2)).toBe('far');
    expect(shortfall).toEqual([3]);
  });

  it('never gives one token to two combatants', () => {
    const { reuse, shortfall } = matchTokens([{ key: 1, actorId: 'a2' }, { key: 2, actorId: 'a2' }], [token('t', 'a2')]);

    expect([...reuse.values()]).toEqual(['t']);
    expect(shortfall).toEqual([2]);
  });
});

describe('gridSlots', () => {
  it('starts at the centre and spirals out around occupied cells', () => {
    const slots = gridSlots({ x: 500, y: 500 }, 100, [{ x: 500, y: 500, width: 100, height: 100 }], 3);

    expect(slots).toHaveLength(3);
    expect(slots).not.toContainEqual({ x: 500, y: 500 });
    slots.forEach((s) => {
      expect(Math.abs(s.x - 500)).toBeLessThanOrEqual(100);
      expect(Math.abs(s.y - 500)).toBeLessThanOrEqual(100);
    });
  });

  it('gives distinct cells', () => {
    const slots = gridSlots({ x: 0, y: 0 }, 50, [], 9);

    expect(new Set(slots.map((s) => `${s.x},${s.y}`)).size).toBe(9);
  });
});
