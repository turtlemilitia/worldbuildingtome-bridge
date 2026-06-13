/**
 * Switch the world's music to a named playlist sound. The app sends a track by
 * name (sounds ids differ per world, so names are the portable handle); we find
 * the matching sound, stop whatever is currently playing, and play it. When
 * `playlistName` is given it scopes the search, falling back to every playlist
 * if that playlist has no match.
 *
 * @param {{ trackName?: string, playlistName?: string | null, replace?: boolean }} payload
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

  if (payload?.replace !== false) {
    await stopEverything();
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

async function stopEverything() {
  const playing = (globalThis.game?.playlists?.contents ?? []).filter((p) => p.playing);
  await Promise.all(playing.map((p) => p.stopAll()));
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}
