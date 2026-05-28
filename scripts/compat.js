// Single source of truth for cross-version Foundry API differences.
//
// V12: ImagePopout is a top-level global.
// V13+: it lives at foundry.applications.apps.ImagePopout.
//
// Action handlers import from here so future drift is one file to update.

export function resolveImagePopout() {
  return (
    globalThis.foundry?.applications?.apps?.ImagePopout ??
    globalThis.ImagePopout ??
    null
  );
}

export function getCoreVersion() {
  return globalThis.game?.version ?? globalThis.game?.data?.version ?? 'unknown';
}
