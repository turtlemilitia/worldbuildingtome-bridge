import { createImagePopout } from '../compat.js';

/**
 * Pop out the image on the GM's screen and broadcast it to every connected
 * client via Foundry's own socket. Foundry suppresses the broadcast for
 * non-GM callers, but the module only connects as a GM in the first place
 * (see main.js gate on `game.user.isGM`).
 *
 * @param {{ url: string, title?: string }} payload
 */
export default async function shareImage(payload) {
  const popout = createImagePopout({
    src: payload.url,
    title: payload.title || 'World Building Tome',
  });

  if (!popout) {
    ui.notifications?.error('WBT: ImagePopout API not found on this Foundry version.');
    return;
  }

  const untag = tagPopoutElement(popout);

  try {
    await popout.render(true);
    popout.shareImage();
  } finally {
    untag();
  }
}

/**
 * Scope a class onto our popout so styles/wbt.css can override its image sizing
 * without touching Foundry's native popouts. Done via the render hook because
 * `html` is an HTMLElement on V13+. Returns a teardown so the caller can drop
 * the listener even if the popout never renders.
 *
 * @param {object} popout
 * @returns {() => void}
 */
function tagPopoutElement(popout) {
  const hookId = Hooks.on('renderImagePopout', (app, html) => {
    if (app !== popout) {
      return;
    }
    const root = html instanceof HTMLElement ? html : html?.[0];
    root?.classList?.add('wbt-image-popout');
  });

  return () => Hooks.off('renderImagePopout', hookId);
}
