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

// V13+ ImagePopout is an ApplicationV2: a single options object with the title
// under `window`, and it sizes the frame from `options.src`. V12 takes the
// positional (src, options) form. Passing the V12 shape to V13 drops the title
// and trips a deprecation warning.
export function createImagePopout({ src, title }) {
  const ImagePopout = resolveImagePopout();
  if (!ImagePopout) {
    return null;
  }

  if (globalThis.foundry?.applications?.apps?.ImagePopout) {
    return new ImagePopout({ src, window: { title } });
  }

  return new ImagePopout(src, { title, shareable: true });
}

export function getCoreVersion() {
  return globalThis.game?.version ?? globalThis.game?.data?.version ?? 'unknown';
}
