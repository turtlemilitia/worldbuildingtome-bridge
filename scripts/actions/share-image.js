import { resolveImagePopout } from '../compat.js';

/**
 * Pop out the image on the GM's screen and broadcast it to every connected
 * client via Foundry's own socket. Foundry suppresses the broadcast for
 * non-GM callers, but the module only connects as a GM in the first place
 * (see main.js gate on `game.user.isGM`).
 *
 * @param {{ url: string, title?: string }} payload
 */
export default async function shareImage(payload) {
  const ImagePopout = resolveImagePopout();
  if (!ImagePopout) {
    ui.notifications?.error('WBT: ImagePopout API not found on this Foundry version.');
    return;
  }

  const popout = new ImagePopout(payload.url, {
    title: payload.title || 'World Building Tome',
    shareable: true,
  });

  await popout.render(true);
  popout.shareImage();
}
