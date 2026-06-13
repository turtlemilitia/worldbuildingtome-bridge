// Reports the world's playlists up to the app so its editor can offer a real
// track picker. Outbound counterpart to the inbound action handlers — the app
// matches play-track requests against these names.

const LOG_PREFIX = '[WBT]';
const REPORT_DEBOUNCE_MS = 1000;

/**
 * @returns {Array<{ name: string, sounds: Array<{ name: string }> }>}
 */
export function collectPlaylists() {
  const playlists = globalThis.game?.playlists?.contents ?? [];

  return playlists
    .map((playlist) => ({
      name: String(playlist.name ?? '').trim(),
      sounds: (playlist.sounds?.contents ?? Array.from(playlist.sounds ?? []))
        .map((sound) => ({ name: String(sound.name ?? '').trim() }))
        .filter((sound) => sound.name !== ''),
    }))
    .filter((playlist) => playlist.name !== '');
}

/**
 * @param {string} apiBase
 * @param {string} token
 * @returns {Promise<void>}
 */
export async function reportPlaylists(apiBase, token) {
  const res = await fetch(`${apiBase}/api/foundry-connections/me/playlists`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ playlists: collectPlaylists() }),
  });

  if (!res.ok) {
    throw new Error(`playlist report returned ${res.status}`);
  }
}

/**
 * Re-report whenever the world's playlists or sounds change. Debounced so a
 * burst of edits collapses into one POST. Returns a teardown that drops the
 * hooks.
 *
 * @param {string} apiBase
 * @param {string} token
 * @returns {() => void}
 */
export function watchPlaylists(apiBase, token) {
  let timer = null;

  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      reportPlaylists(apiBase, token).catch((err) => {
        console.warn(`${LOG_PREFIX} playlist report failed:`, err);
      });
    }, REPORT_DEBOUNCE_MS);
  };

  const hookNames = [
    'createPlaylist', 'updatePlaylist', 'deletePlaylist',
    'createPlaylistSound', 'updatePlaylistSound', 'deletePlaylistSound',
  ];
  const registered = hookNames.map((name) => [name, Hooks.on(name, schedule)]);

  return () => registered.forEach(([name, id]) => Hooks.off(name, id));
}
