import { actions } from './actions/index.js';
import { getCoreVersion } from './compat.js';

const MODULE_ID = 'worldbuildingtome-bridge';
const LOG_PREFIX = '[WBT]';

const SETTINGS = {
  apiBase: 'apiBase',
  connectionToken: 'connectionToken',
};

/** @type {ReturnType<typeof connect> | null} */
let activeConnection = null;

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, SETTINGS.apiBase, {
    name: 'WBT.settings.apiBase.name',
    hint: 'WBT.settings.apiBase.hint',
    scope: 'world',
    config: true,
    type: String,
    default: 'https://api.worldbuildingtome.io',
  });

  game.settings.register(MODULE_ID, SETTINGS.connectionToken, {
    name: 'WBT.settings.connectionToken.name',
    hint: 'WBT.settings.connectionToken.hint',
    scope: 'world',
    config: true,
    type: String,
    default: '',
  });
});

Hooks.once('ready', async () => {
  if (!game.user?.isGM) {
    // Only the GM holds the connection. Non-GM clients receive image
    // popouts via Foundry's own socket once the GM dispatches them.
    return;
  }

  const apiBase = String(game.settings.get(MODULE_ID, SETTINGS.apiBase) || '').replace(/\/+$/, '');
  const token = String(game.settings.get(MODULE_ID, SETTINGS.connectionToken) || '').trim();

  if (!apiBase || !token) {
    console.info(`${LOG_PREFIX} Module is unconfigured — set API base + token in Module Settings.`);
    return;
  }

  try {
    const bootstrap = await fetchBootstrap(apiBase, token);
    activeConnection = connect({ apiBase, token, bootstrap });
    console.info(`${LOG_PREFIX} connected as connection #${bootstrap.data.id} (Foundry ${getCoreVersion()})`);
    ui.notifications?.info(`World Building Tome: connected as "${bootstrap.data.name}".`);
  } catch (err) {
    console.error(`${LOG_PREFIX} bootstrap failed:`, err);
    ui.notifications?.error(`World Building Tome: ${err.message || 'connection failed'}`);
  }
});

/**
 * @typedef {{
 *   data: { id: number, name: string, campaign_id: number, user_id: number, last_seen_at: string | null },
 *   broadcast: { key: string, host: string, port: number, scheme: 'http' | 'https', authEndpoint: string }
 * }} Bootstrap
 */

/**
 * @param {string} apiBase
 * @param {string} token
 * @returns {Promise<Bootstrap>}
 */
async function fetchBootstrap(apiBase, token) {
  const res = await fetch(`${apiBase}/api/foundry-connections/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (res.status === 401) {
    throw new Error('token rejected (401). Check the connection token in Module Settings.');
  }
  if (res.status === 403) {
    throw new Error('token missing foundry:write ability (403).');
  }
  if (res.status === 404) {
    throw new Error('token is not bound to a FoundryConnection (404).');
  }
  if (!res.ok) {
    throw new Error(`bootstrap returned ${res.status}`);
  }

  return res.json();
}

/**
 * Open the Pusher (Reverb) connection and subscribe to the private channel
 * for this FoundryConnection. Returns the channel so callers can inspect /
 * disconnect later if needed.
 *
 * @param {{ apiBase: string, token: string, bootstrap: Bootstrap }} args
 */
function connect({ apiBase, token, bootstrap }) {
  const { broadcast, data: connection } = bootstrap;

  // Pusher global is loaded via the vendored UMD listed in module.json.
  const pusher = new globalThis.Pusher(broadcast.key, {
    // pusher-js rejects a missing cluster even when wsHost (Reverb) makes it
    // unused; a throwaway value satisfies the check.
    cluster: 'reverb',
    wsHost: broadcast.host,
    wsPort: broadcast.port,
    wssPort: broadcast.port,
    forceTLS: broadcast.scheme === 'https',
    enabledTransports: ['ws', 'wss'],
    disableStats: true,
    authEndpoint: broadcast.authEndpoint,
    auth: {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
  });

  pusher.connection.bind('error', (err) => {
    console.error(`${LOG_PREFIX} pusher error:`, err);
  });

  pusher.connection.bind('state_change', ({ previous, current }) => {
    console.debug(`${LOG_PREFIX} ws state: ${previous} → ${current}`);
  });

  const channelName = `private-foundry.connection.${connection.id}`;
  const channel = pusher.subscribe(channelName);

  channel.bind('pusher:subscription_error', (err) => {
    console.error(`${LOG_PREFIX} channel auth failed:`, err);
    ui.notifications?.error('World Building Tome: channel authentication failed. Check token + ability.');
  });

  // bind_global fires for every event on the channel. We dispatch by
  // event name through the registry; pusher's internal pusher:* frames
  // are ignored.
  channel.bind_global((eventName, payload) => {
    if (eventName.startsWith('pusher:') || eventName.startsWith('pusher_internal:')) {
      return;
    }

    const handler = actions[eventName];
    if (!handler) {
      console.warn(`${LOG_PREFIX} no handler for event "${eventName}"`);
      ui.notifications?.warn(`World Building Tome: received unknown event "${eventName}".`);
      return;
    }

    Promise.resolve(handler(payload)).catch((err) => {
      console.error(`${LOG_PREFIX} handler "${eventName}" threw:`, err);
      ui.notifications?.error(`World Building Tome: ${eventName} failed — ${err.message || err}`);
    });
  });

  return { pusher, channel };
}
