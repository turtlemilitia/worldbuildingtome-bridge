/**
 * Play a named playlist sound. The app sends a track by name (sound ids differ
 * per world, so names are the portable handle); we find the matching sound and
 * hand it to Foundry. When `playlistName` is given it scopes the search,
 * falling back to every playlist if that playlist has no match.
 *
 * What keeps playing is Foundry's call, not ours: `playSound` already
 * "determine[s] which other sounds should remain playing" from the owning
 * playlist's mode — sequential and shuffle replace their current track,
 * simultaneous and soundboard layer on top. Stopping anything ourselves would
 * override the mode the GM chose for that playlist.
 *
 * @param {{ trackName?: string, playlistName?: string | null }} payload
 */
export default async function playTrack(payload) {
  const trackName = String(payload?.trackName ?? '').trim();

  if (!trackName) {
    ui.notifications?.warn('World Building Tome: play-track received no track name.');
    return;
  }

  const match = findSound(trackName, payload?.playlistName);

  if (!match) {
    ui.notifications?.warn(`World Building Tome: no track named "${trackName}" was found.`);
    return;
  }

  await match.playlist.playSound(match.sound);
  ui.notifications?.info(`World Building Tome: now playing "${match.sound.name}".`);
}

/**
 * @param {string} trackName
 * @param {string | null | undefined} playlistName
 * @returns {{ playlist: object, sound: object } | null}
 */
function findSound(trackName, playlistName) {
  const wanted = trackName.toLowerCase();
  const playlists = globalThis.game?.playlists?.contents ?? [];

  const scoped = playlistName
    ? playlists.filter((p) => normalize(p.name) === normalize(playlistName))
    : [];
  const pools = scoped.length ? scoped : playlists;

  for (const playlist of pools) {
    const sounds = playlist.sounds?.contents ?? Array.from(playlist.sounds ?? []);
    const sound = sounds.find((s) => normalize(s.name) === wanted);
    if (sound) {
      return { playlist, sound };
    }
  }

  return null;
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}
