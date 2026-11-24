import shareImage from './share-image.js';
import playTrack from './play-track.js';
import { onCombatChanged, onCombatDeleted, onCombatStarted } from '../combat/mirror.js';

/**
 * Registry of broadcast event names → handler. Adding a future action is
 * one new file + one new entry. Unknown events warn but don't crash; see
 * main.js for the dispatch loop.
 *
 * @type {Record<string, (payload: any) => Promise<void> | void>}
 */
export const actions = {
  'share-image': shareImage,
  'play-track': playTrack,
  'combat-started': onCombatStarted,
  'combat-changed': onCombatChanged,
  'combat-deleted': onCombatDeleted,
};
