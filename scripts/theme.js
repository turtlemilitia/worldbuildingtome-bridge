export const THEME_SETTING = 'tomeTheme';
export const THEME_CLASS = 'wbt-theme';

const FONT_LINK_ID = 'wbt-theme-fonts';
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400&family=Poppins:wght@400;500;600&display=swap';

/**
 * @param {string} moduleId
 */
export function registerTheme(moduleId) {
  game.settings.register(moduleId, THEME_SETTING, {
    name: 'WBT.settings.tomeTheme.name',
    hint: 'WBT.settings.tomeTheme.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: (enabled) => applyTheme(Boolean(enabled)),
  });

  applyTheme(Boolean(game.settings.get(moduleId, THEME_SETTING)));
}

/**
 * The fonts are only fetched once the theme is on, so a player who turns it
 * off makes no request to Google Fonts.
 *
 * @param {boolean} enabled
 * @param {Document} [doc]
 */
export function applyTheme(enabled, doc = document) {
  doc.body.classList.toggle(THEME_CLASS, enabled);

  if (enabled && !doc.getElementById(FONT_LINK_ID)) {
    const link = doc.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    doc.head.appendChild(link);
  }
}
