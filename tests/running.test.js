import { describe, expect, it } from 'vitest';
import { describeCombat } from '../scripts/combat/running.js';

describe('describeCombat', () => {
  it('reports what the Tome needs to pick a fight up', () => {
    const zombieActor = { type: 'npc', hasPlayerOwner: false, uuid: 'Scene.s.Token.t2.Actor.z', statuses: new Set(['prone']), system: { attributes: { hp: { value: 31, max: 33, temp: 0 }, ac: { value: 8 } } } };
    const combat = {
      id: 'Combat.live',
      round: 2,
      scene: { name: 'Crypt' },
      flags: {},
      combatant: { id: 'cz' },
      combatants: { contents: [
        { id: 'cz', name: 'Zombie', tokenId: 't2', token: { baseActor: { uuid: 'Actor.zombie' } }, actor: zombieActor, initiative: 6, isDefeated: false, hidden: true },
      ] },
    };

    expect(describeCombat(combat)).toEqual({
      id: 'Combat.live',
      scene: 'Crypt',
      round: 2,
      linked: false,
      currentCombatantId: 'cz',
      combatants: [{
        id: 'cz', name: 'Zombie', tokenId: 't2', actorUuid: 'Actor.zombie', isPlayer: false, initiative: 6,
        hp: 31, maxHp: 33, temp: 0, ac: 8, defeated: false, hidden: true, statuses: ['prone'],
      }],
    });
  });
});
