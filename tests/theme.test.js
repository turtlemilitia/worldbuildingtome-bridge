import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, registerTheme, THEME_CLASS, THEME_SETTING } from '../scripts/theme.js';

const fontLinks = () => document.head.querySelectorAll('link#wbt-theme-fonts');

describe('applyTheme', () => {
  afterEach(() => {
    document.body.classList.remove(THEME_CLASS);
    fontLinks().forEach((link) => link.remove());
  });

  it('puts the theme class on the body and loads the Tome fonts', () => {
    applyTheme(true);

    expect(document.body.classList.contains(THEME_CLASS)).toBe(true);
    expect(fontLinks()).toHaveLength(1);
    expect(fontLinks()[0].href).toContain('family=Poppins');
  });

  it('loads the fonts once however often it is switched on', () => {
    applyTheme(true);
    applyTheme(false);
    applyTheme(true);

    expect(fontLinks()).toHaveLength(1);
  });

  it('takes the class off and fetches nothing when switched off', () => {
    document.body.classList.add(THEME_CLASS);

    applyTheme(false);

    expect(document.body.classList.contains(THEME_CLASS)).toBe(false);
    expect(fontLinks()).toHaveLength(0);
  });
});

describe('registerTheme', () => {
  let registered;
  let stored;

  beforeEach(() => {
    registered = {};
    stored = undefined;
    globalThis.game = {
      settings: {
        register: vi.fn((module, key, config) => {
          registered[`${module}.${key}`] = config;
        }),
        get: vi.fn((module, key) => stored ?? registered[`${module}.${key}`].default),
      },
    };
  });

  afterEach(() => {
    delete globalThis.game;
    document.body.classList.remove(THEME_CLASS);
    fontLinks().forEach((link) => link.remove());
  });

  it('registers a per-browser toggle that is on by default', () => {
    registerTheme('wbt');

    expect(registered[`wbt.${THEME_SETTING}`]).toMatchObject({ scope: 'client', config: true, type: Boolean, default: true });
    expect(document.body.classList.contains(THEME_CLASS)).toBe(true);
  });

  it('leaves Foundry untouched for a player who turned it off', () => {
    stored = false;

    registerTheme('wbt');

    expect(document.body.classList.contains(THEME_CLASS)).toBe(false);
    expect(fontLinks()).toHaveLength(0);
  });

  it('switches live when the setting changes, without a reload', () => {
    registerTheme('wbt');
    const { onChange } = registered[`wbt.${THEME_SETTING}`];

    onChange(false);
    expect(document.body.classList.contains(THEME_CLASS)).toBe(false);

    onChange(true);
    expect(document.body.classList.contains(THEME_CLASS)).toBe(true);
  });
});
