// Dev-only: writes styles/tome-icons.css from lucide-react's icon definitions
// (the frontend's node_modules has them). Not shipped in the module zip.
import fs from 'node:fs';
const [,, iconsDir, out] = process.argv;
const map = [
  ['#sidebar-tabs [data-tab="chat"]', 'message-square'],
  ['#sidebar-tabs [data-tab="combat"]', 'swords'],
  ['#sidebar-tabs [data-tab="scenes"]', 'map'],
  ['#sidebar-tabs [data-tab="placeables"]', 'shapes'],
  ['#sidebar-tabs [data-tab="actors"]', 'users'],
  ['#sidebar-tabs [data-tab="items"]', 'backpack'],
  ['#sidebar-tabs [data-tab="journal"]', 'book-open'],
  ['#sidebar-tabs [data-tab="tables"]', 'dices'],
  ['#sidebar-tabs [data-tab="cards"]', 'layers'],
  ['#sidebar-tabs [data-tab="macros"]', 'code-2'],
  ['#sidebar-tabs [data-tab="playlists"]', 'music'],
  ['#sidebar-tabs [data-tab="compendium"]', 'library'],
  ['#sidebar-tabs [data-tab="settings"]', 'settings'],
  ['#sidebar-tabs .collapse', 'chevron-right'],
  ['#scene-controls [data-control="tokens"]', 'user'],
  ['#scene-controls [data-control="templates"]', 'ruler'],
  ['#scene-controls [data-control="tiles"]', 'image'],
  ['#scene-controls [data-control="drawings"]', 'pencil'],
  ['#scene-controls [data-control="walls"]', 'construction'],
  ['#scene-controls [data-control="lighting"]', 'lightbulb'],
  ['#scene-controls [data-control="sounds"]', 'speaker'],
  ['#scene-controls [data-control="regions"]', 'box-select'],
  ['#scene-controls [data-control="notes"]', 'sticky-note'],
  ['#scene-controls [data-tool="select"]', 'mouse-pointer'],
  ['#scene-controls [data-tool="target"]', 'crosshair'],
  ['#scene-controls [data-tool="ruler"]', 'ruler'],
  ['#scene-controls [data-tool="unconstrainedMovement"]', 'ghost'],
  ['#hotbar [data-action="mute"]', 'volume-2'],
  ['#hotbar [data-action="menu"]', 'align-left'],
  ['#hotbar [data-action="lock"]', 'unlock'],
  ['#hotbar [data-action="clear"]', 'trash-2'],
  ['.application .window-header [data-action="toggleControls"]', 'more-vertical'],
  ['.application .window-header [data-action="close"]', 'x'],
  ['#token-hud [data-action="sort"] i', 'layers'],
  ['#token-hud [data-action="locked"] i.fa-lock-open', 'unlock'],
  ['#token-hud [data-action="locked"] i.fa-lock', 'lock'],
  ['#token-hud [data-action="config"] i', 'settings'],
  ['#token-hud [data-action="visibility"] i.fa-eye', 'eye'],
  ['#token-hud [data-action="visibility"] i.fa-eye-slash', 'eye-off'],
  ['#token-hud [data-action="target"] i', 'crosshair'],
  ['#token-hud [data-action="combat"] i', 'swords'],
];

// The Tome combat tracker's condition tones (CONDITION_TONES in the frontend's
// lib/combat/presets.ts): text-*-200 for the glyph, *-900/50 fill, *-700/70 rim.
const tones = {
  stone: ['#e7e5e4', 'rgb(68 64 60 / 0.6)', 'rgb(120 113 108 / 0.6)'],
  pink: ['#fbcfe8', 'rgb(131 24 67 / 0.5)', 'rgb(190 24 93 / 0.7)'],
  amber: ['#fde68a', 'rgb(120 53 15 / 0.5)', 'rgb(180 83 9 / 0.7)'],
  purple: ['#e9d5ff', 'rgb(88 28 135 / 0.5)', 'rgb(126 34 206 / 0.7)'],
  orange: ['#fed7aa', 'rgb(124 45 18 / 0.5)', 'rgb(194 65 12 / 0.7)'],
  red: ['#fecaca', 'rgb(127 29 29 / 0.5)', 'rgb(185 28 28 / 0.7)'],
  sky: ['#bae6fd', 'rgb(12 74 110 / 0.5)', 'rgb(3 105 161 / 0.7)'],
  green: ['#a7f3d0', 'rgb(6 78 59 / 0.5)', 'rgb(4 120 87 / 0.7)'],
  blue: ['#bfdbfe', 'rgb(30 58 138 / 0.5)', 'rgb(29 78 216 / 0.7)'],
};

// Token HUD status effects. The first sixteen are the Tome's own D&D 5e
// conditions (DND5E_PRESET), same glyph and tone; the rest are dnd5e statuses
// the Tome has no preset for, given the nearest Lucide glyph.
const statuses = [
  ['blinded', 'eye-off', 'stone'],
  ['charmed', 'heart', 'pink'],
  ['deafened', 'ear-off', 'stone'],
  ['exhaustion', 'battery-low', 'amber'],
  ['frightened', 'ghost', 'purple'],
  ['grappled', 'hand', 'orange'],
  ['incapacitated', 'ban', 'red'],
  ['invisible', 'sparkles', 'sky'],
  ['paralyzed', 'zap', 'red'],
  ['petrified', 'mountain', 'stone'],
  ['poisoned', 'flask-conical', 'green'],
  ['prone', 'arrow-down-to-line', 'amber'],
  ['restrained', 'link', 'orange'],
  ['stunned', 'stars', 'red'],
  ['unconscious', 'moon', 'red'],
  ['concentrating', 'focus', 'blue'],
  ['dead', 'skull', 'red'],
  ['coverHalf', 'shield-half', 'stone'],
  ['coverThreeQuarters', 'shield', 'stone'],
  ['coverTotal', 'shield-check', 'stone'],
  ['bleeding', 'droplet', 'red'],
  ['burning', 'flame', 'orange'],
  ['burrowing', 'shovel', 'amber'],
  ['cursed', 'wand-2', 'purple'],
  ['dehydration', 'droplets', 'amber'],
  ['diseased', 'bug', 'green'],
  ['dodging', 'wind', 'sky'],
  ['ethereal', 'cloud-fog', 'sky'],
  ['falling', 'arrow-big-down', 'stone'],
  ['flying', 'feather', 'sky'],
  ['hiding', 'venetian-mask', 'stone'],
  ['hovering', 'arrow-up-from-line', 'sky'],
  ['malnutrition', 'utensils-crossed', 'amber'],
  ['marked', 'crosshair', 'red'],
  ['silenced', 'volume-x', 'stone'],
  ['sleeping', 'bed', 'blue'],
  ['stable', 'heart-pulse', 'green'],
  ['suffocation', 'cloud-off', 'blue'],
  ['surprised', 'alert-triangle', 'amber'],
  ['transformed', 'refresh-cw', 'purple'],
];

// <img> icons can't take a mask, so their picture is replaced outright with
// `content:` and the glyph is drawn in a fixed stroke colour.
const imgSwaps = [
  ['#token-hud [data-palette="effects"] > img', 'tag'],
  ['#token-hud [data-palette="movementActions"] > img', 'footprints'],
  ['#token-hud [data-movement-action="walk"] img', 'footprints'],
  ['#token-hud [data-movement-action="fly"] img', 'feather'],
  ['#token-hud [data-movement-action="swim"] img', 'waves'],
  ['#token-hud [data-movement-action="burrow"] img', 'shovel'],
  ['#token-hud [data-movement-action="crawl"] img', 'snail'],
  ['#token-hud [data-movement-action="climb"] img', 'mountain-snow'],
  ['#token-hud [data-movement-action="jump"] img', 'move-up'],
  ['#token-hud [data-movement-action="blink"] img', 'zap'],
];
const attrs = (o) => Object.entries(o).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ');
const svgFor = (name, stroke = 'black') => {
  const src = fs.readFileSync(`${iconsDir}/${name}.js`, 'utf8');
  const alias = src.match(/export \{ default \} from '\.\/([^']+)\.js'/);
  if (alias) {
    return svgFor(alias[1], stroke);
  }
  const nodes = eval(src.match(/createLucideIcon\("[^"]+", (\[[\s\S]*\])\);/)[1]);
  const body = nodes.map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
};
const url = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}")`;
const scoped = (sel) => `body.wbt-theme ${sel}`;
let css = `/* Generated by tools/build-tome-icons.mjs — edit the map there and rerun:
     node tools/build-tome-icons.mjs <lucide-react>/dist/esm/icons styles/tome-icons.css
   Foundry's chrome icons swapped for the Lucide glyphs the Tome
   uses, drawn as masks so they take the button's text colour.
   Lucide v0.279.0 — ISC License. Copyright (c) for portions of Lucide are held
   by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for
   Lucide are held by Lucide Contributors 2022. Permission to use, copy, modify,
   and/or distribute this software for any purpose with or without fee is
   hereby granted, provided that the above copyright notice and this permission
   notice appear in all copies. */\n\n`;
for (const [sel, name] of map) {
  css += `${scoped(sel)} { --wbt-icon: ${url(svgFor(name))}; }\n`;
}
css += `\n${map.map(([sel]) => scoped(sel) + '::before').join(',\n')} {
  content: "";
  display: inline-block;
  width: var(--wbt-icon-size, 18px);
  height: var(--wbt-icon-size, 18px);
  background-color: currentColor;
  -webkit-mask: var(--wbt-icon) center / contain no-repeat;
  mask: var(--wbt-icon) center / contain no-repeat;
}\n`;
css += '\n';
for (const [id, name, tone] of statuses) {
  const [glyph, fill, rim] = tones[tone];
  css += `${scoped(`#token-hud .effect-control[data-status-id="${id}"]`)} { content: ${url(svgFor(name, glyph))}; --wbt-tone-bg: ${fill}; --wbt-tone-border: ${rim}; }\n`;
}
css += '\n';
for (const [sel, name] of imgSwaps) {
  css += `${scoped(sel)} { content: ${url(svgFor(name, '#d6d3d1'))}; }\n`;
}
fs.writeFileSync(out, css);
console.log(map.length, 'masked,', statuses.length, 'statuses,', imgSwaps.length, 'images,', css.length, 'bytes');
