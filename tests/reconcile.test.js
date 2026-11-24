import { describe, expect, it } from 'vitest';
import { findMirrored, foundryInitiatives, planCombat, planConditions, revealedIds, statusFor, turnCommandFor, unappliedOps } from '../scripts/combat/reconcile.js';

const tome = (overrides = {}) => ({
  status: 'active',
  round: 2,
  turn_combatant_id: 2,
  order: [1, 2, 3, 4],
  combatants: [
    { id: 1, kind: 'npc', initiative: 20, follows_combatant_id: null, hidden: false, hp: 10, foundry_combatant_id: 'f1' },
    { id: 2, kind: 'lair', initiative: 20, follows_combatant_id: null, hidden: false, hp: null, foundry_combatant_id: 'f2' },
    { id: 3, kind: 'pc', initiative: 15, follows_combatant_id: null, hidden: false, hp: 0, foundry_combatant_id: 'f3' },
    { id: 4, kind: 'familiar', initiative: null, follows_combatant_id: 3, hidden: true, hp: 1, foundry_combatant_id: null },
  ],
  ...overrides,
});

describe('foundryInitiatives', () => {
  it('spreads ties by hundredths in Tome order and gives followers their owner\'s place', () => {
    const values = foundryInitiatives(tome());

    expect(values.get(1)).toBe(20);
    expect(values.get(2)).toBe(19.99);
    expect(values.get(3)).toBe(15);
    expect(values.get(4)).toBe(14.99);
  });

  it('leaves combatants without initiative empty', () => {
    const state = tome();
    state.combatants[2].initiative = null;

    expect(foundryInitiatives(state).get(3)).toBeNull();
  });
});

describe('planCombat', () => {
  const foundry = (overrides = {}) => ({
    round: 2,
    turnCombatantId: 'f1',
    combatants: [
      { id: 'f1', initiative: 20, hidden: false, defeated: false },
      { id: 'f2', initiative: 20, hidden: false, defeated: false },
      { id: 'f3', initiative: 15, hidden: false, defeated: false },
      { id: 'stray', initiative: 3, hidden: false, defeated: false },
    ],
    ...overrides,
  });

  it('corrects initiative, deletes strays, lists the unplaced and moves the turn', () => {
    const plan = planCombat(tome(), foundry());

    expect(plan.updates).toEqual([{ _id: 'f2', initiative: 19.99 }]);
    expect(plan.deletes).toEqual(['stray']);
    expect(plan.missing.map((c) => c.id)).toEqual([4]);
    expect(plan.turn).toEqual({ round: 2, combatantId: 'f2' });
  });

  it('marks a downed monster defeated, but never a player at 0', () => {
    const state = tome();
    state.combatants[0].hp = 0;

    const plan = planCombat(state, foundry({ turnCombatantId: 'f2' }));

    expect(plan.updates).toContainEqual({ _id: 'f1', defeated: true });
    expect(plan.updates.some((u) => u._id === 'f3' && 'defeated' in u)).toBe(false);
    expect(plan.turn).toBeNull();
  });

  it('does not move the turn while the combat is still being set up', () => {
    expect(planCombat(tome({ status: 'setup' }), foundry()).turn).toBeNull();
  });
});

describe('planConditions', () => {
  const known = new Set(['prone', 'frightened', 'concentrating']);

  it('turns on status icons, creates free-text effects and removes ones the Tome dropped', () => {
    const plan = planConditions(
      [
        { id: 'c1', name: 'Prone' },
        { id: 'c2', name: 'Hexed' },
        { id: 'c3', name: 'Frightened', status_id: 'frightened' },
      ],
      [
        { id: 'e1', statuses: ['frightened'], conditionId: 'c3' },
        { id: 'e2', statuses: ['stunned'], conditionId: 'gone' },
        { id: 'e3', statuses: ['bloodied'], conditionId: null },
      ],
      known,
    );

    expect(plan.enable).toEqual([{ status: 'prone', conditionId: 'c1' }]);
    expect(plan.create).toEqual([{ name: 'Hexed', conditionId: 'c2' }]);
    expect(plan.remove).toEqual(['e2']);
    expect(plan.adopt).toEqual([]);
  });

  it('adopts a status the GM set in Foundry instead of adding it twice', () => {
    const plan = planConditions([{ id: 'c1', name: 'Prone', status_id: 'prone' }], [{ id: 'e1', statuses: ['prone'], conditionId: null }], known);

    expect(plan.adopt).toEqual([{ effectId: 'e1', conditionId: 'c1' }]);
    expect(plan.enable).toEqual([]);
  });
});

describe('statusFor', () => {
  it('maps by status id, then by name, ignoring a level number', () => {
    const known = new Set(['exhaustion', 'prone']);

    expect(statusFor({ name: 'Knocked down', status_id: 'prone' }, known)).toBe('prone');
    expect(statusFor({ name: 'Exhaustion 2' }, known)).toBe('exhaustion');
    expect(statusFor({ name: 'Hexed' }, known)).toBeNull();
  });
});

describe('unappliedOps', () => {
  it('skips HP changes already applied here', () => {
    expect(unappliedOps([{ id: 'a' }, { id: 'b' }], new Set(['a']))).toEqual([{ id: 'b' }]);
    expect(unappliedOps(undefined, new Set())).toEqual([]);
  });
});

describe('findMirrored', () => {
  const combats = [
    { id: 'a', tome: null },
    { id: 'b', tome: 7 },
    { id: 'c', tome: 9 },
  ];
  const tomeIdOf = (c) => c.tome;

  it('finds the combat by the Foundry id the Tome recorded', () => {
    expect(findMirrored(combats, { combatId: 99, foundryCombatId: 'a' }, tomeIdOf)?.id).toBe('a');
  });

  it('falls back to our flag when the link was never reported', () => {
    expect(findMirrored(combats, { combatId: 9, foundryCombatId: null }, tomeIdOf)?.id).toBe('c');
  });

  it('leaves other combats alone when nothing matches', () => {
    expect(findMirrored(combats, { combatId: 1, foundryCombatId: 'zzz' }, tomeIdOf)).toBeNull();
  });
});

describe('turnCommandFor', () => {
  it('reports Next and Back', () => {
    expect(turnCommandFor({ turn: 2 }, {})).toBe('advance');
    expect(turnCommandFor({ turn: 1 }, { direction: -1 })).toBe('back');
    expect(turnCommandFor({ round: 3, turn: 0 }, { direction: 1 })).toBe('advance');
  });

  it('ignores Foundry keeping the same combatant current after a re-sort', () => {
    expect(turnCommandFor({ turn: 3 }, { turnEvents: false })).toBeNull();
  });

  it('ignores updates that leave the turn alone', () => {
    expect(turnCommandFor({ name: 'Crypt' }, {})).toBeNull();
  });
});

describe('revealedIds', () => {
  it('picks only the combatants being shown', () => {
    expect(revealedIds([{ _id: 'a', hidden: false }, { _id: 'b', hidden: true }, { _id: 'c', initiative: 12 }])).toEqual(['a']);
  });
});
