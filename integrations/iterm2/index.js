// iTerm2 (macOS) integration: exports a theme as an .itermcolors preset (Apple plist XML).
// The user imports it in iTerm2 > Settings > Profiles > Colors > Color Presets > Import.
// We never edit iTerm2's own preferences.
import { writeFileAtomic, hexToRgb } from '../../packages/core/src/index.js';
import { normalizeTheme, ANSI_KEYS } from '../../packages/themes/src/index.js';

function colorDict(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => (v / 255).toFixed(6));
  return [
    '\t<dict>',
    '\t\t<key>Alpha Component</key><real>1</real>',
    `\t\t<key>Blue Component</key><real>${b}</real>`,
    '\t\t<key>Color Space</key><string>sRGB</string>',
    `\t\t<key>Green Component</key><real>${g}</real>`,
    `\t\t<key>Red Component</key><real>${r}</real>`,
    '\t</dict>',
  ].join('\n');
}

/** .itermcolors XML for a theme. */
export function toItermColors(theme) {
  const t = normalizeTheme(theme);
  const entries = [];
  ANSI_KEYS.forEach((k, i) => entries.push([`Ansi ${i} Color`, t.ansi[k]]));
  entries.push(
    ['Background Color', t.palette.background],
    ['Foreground Color', t.palette.foreground],
    ['Bold Color', t.palette.foreground],
    ['Cursor Color', t.palette.primary],
    ['Cursor Text Color', t.palette.background],
    ['Selection Color', t.palette.surface],
    ['Selected Text Color', t.palette.foreground],
    ['Link Color', t.palette.accent],
  );
  const body = entries.map(([k, hex]) => `\t<key>${k}</key>\n${colorDict(hex)}`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
</dict>
</plist>
`;
}

export function writeItermColors(theme, file) {
  writeFileAtomic(file, toItermColors(theme));
  return file;
}

// ---- live colors through a Dynamic Profile -------------------------------------------
// iTerm2 watches ~/Library/Application Support/iTerm2/DynamicProfiles and reloads profiles
// from there on its own (https://iterm2.com/documentation-dynamic-profiles.html). We keep ONE
// profile, "Terminal-Design", whose colors are rewritten on every `td theme set X --terminal`.
// The user makes it the default once (Settings > Profiles > Other Actions > Set as Default);
// from then on every theme change shows up right away. Other settings (font, size...) are
// inherited from the "Default" profile. Only our own file is ever written or removed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PROFILE_NAME = 'Terminal-Design';
export const PROFILE_GUID = 'terminal-design-profile-0001';

export function dynamicProfileFile(home = os.homedir()) {
  return path.join(home, 'Library', 'Application Support', 'iTerm2', 'DynamicProfiles', 'terminal-design.json');
}

export function isItermInstalled({ home = os.homedir(), exists = fs.existsSync } = {}) {
  return exists('/Applications/iTerm.app') || exists(path.join(home, 'Applications', 'iTerm.app'))
    || exists(path.join(home, 'Library', 'Preferences', 'com.googlecode.iterm2.plist'));
}

function colorObject(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => Number((v / 255).toFixed(6)));
  return { 'Red Component': r, 'Green Component': g, 'Blue Component': b, 'Alpha Component': 1, 'Color Space': 'sRGB' };
}

/** Pure: the Dynamic Profiles JSON for a theme. */
export function toDynamicProfile(theme) {
  const t = normalizeTheme(theme);
  const p = { Name: PROFILE_NAME, Guid: PROFILE_GUID, 'Dynamic Profile Parent Name': 'Default', Tags: [`tema: ${t.displayName ?? t.name}`] };
  ANSI_KEYS.forEach((k, i) => { p[`Ansi ${i} Color`] = colorObject(t.ansi[k]); });
  Object.assign(p, {
    'Background Color': colorObject(t.palette.background),
    'Foreground Color': colorObject(t.palette.foreground),
    'Bold Color': colorObject(t.palette.foreground),
    'Cursor Color': colorObject(t.palette.primary),
    'Cursor Text Color': colorObject(t.palette.background),
    'Selection Color': colorObject(t.palette.surface),
    'Selected Text Color': colorObject(t.palette.foreground),
    'Link Color': colorObject(t.palette.accent),
  });
  return { Profiles: [p] };
}

/** Write (or rewrite) our profile with the theme colors. Returns { file, firstTime }. */
export function applyItermProfile(theme, { home = os.homedir() } = {}) {
  const file = dynamicProfileFile(home);
  const firstTime = !fs.existsSync(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, `${JSON.stringify(toDynamicProfile(theme), null, 2)}\n`);
  return { file, firstTime };
}

/** Remove our profile file (iTerm2 then drops the profile). Returns true when something was removed. */
export function removeItermProfile({ home = os.homedir() } = {}) {
  const file = dynamicProfileFile(home);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  return true;
}
