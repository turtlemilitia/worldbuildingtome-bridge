# World Building Tome — Foundry Bridge

A Foundry VTT module that lets the [World Building Tome](https://worldbuildingtome.io) app drive actions inside a live Foundry world.

**v0.1.0 ships one action:** the GM clicks "Show in Foundry" in the app, and the image pops out on every connected player's screen.

## How it works

1. The GM creates a Foundry connection in the World Building Tome app and copies the one-time token.
2. They install this module in their Foundry world and paste the token into the module's settings.
3. On every load, the module opens a WebSocket back to World Building Tome (Reverb + the Pusher protocol) on a per-connection private channel.
4. When the GM triggers an action in the app, the backend broadcasts an event; the module receives it and runs the matching handler — e.g. `share-image` calls `ImagePopout.shareImage()`.

The bearer token is a Laravel Sanctum personal access token scoped to the GM user with the `foundry:write` ability. The module never has unscoped access to the GM's account.

## Compatibility

| Foundry version | Status   |
|-----------------|----------|
| V12             | Compatible (verified) |
| V13             | Compatible (verified) |
| V14             | Compatible (untested) |

API differences across versions are isolated in `scripts/compat.js`.

## Install

Manifest URL: `https://github.com/turtlemilitia/worldbuildingtome-bridge/releases/latest/download/module.json` (once releases are cut).

For local development, clone alongside your Foundry data dir and symlink into `Data/modules/`.

## Settings

| Key               | Purpose |
|-------------------|---------|
| API base URL      | The World Building Tome backend (e.g. `https://api.worldbuildingtome.io`). |
| Connection token  | The Sanctum PAT shown once when the connection is created in the app. Lost tokens require revoke + recreate. |

## Adding a new action

1. New handler at `scripts/actions/<name>.js` — default-export `async function(payload) { ... }`.
2. Register it in `scripts/actions/index.js` keyed by the event's `broadcastAs` string.
3. Backend dispatches a corresponding `App\Events\Foundry\*` event composing `BroadcastsToFoundryConnection`.

No changes to `main.js`, `compat.js`, the channel name, or the auth flow.

## License

MIT.
