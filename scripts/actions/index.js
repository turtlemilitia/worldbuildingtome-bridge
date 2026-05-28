import shareImage from './share-image.js';

/**
 * Registry of broadcast event names → handler. Adding a future action is
 * one new file + one new entry. Unknown events warn but don't crash; see
 * main.js for the dispatch loop.
 *
 * @type {Record<string, (payload: any) => Promise<void> | void>}
 */
export const actions = {
  'share-image': shareImage,
};
