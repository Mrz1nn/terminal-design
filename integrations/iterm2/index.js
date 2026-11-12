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
