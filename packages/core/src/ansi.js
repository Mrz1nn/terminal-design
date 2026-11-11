// Color and text-width helpers. No dependencies.

export const RESET = '\x1b[0m';

/**
 * Color depth: 'truecolor' | '256' | '16' | 'none'.
 * NO_COLOR (https://no-color.org) always wins; TD_COLOR forces a mode.
 */
export function detectColorMode(pref = 'auto', env = process.env) {
  if (env.NO_COLOR) return 'none';
  const forced = env.TD_COLOR || pref;
  if (forced && forced !== 'auto') return forced;
  // Claude Code, Windows Terminal, VS Code and modern conhost all render 24-bit color.
  return 'truecolor';
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbTo256([r, g, b]) {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  const q = (v) => Math.round((v / 255) * 5);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

const BASIC = [
  [0, 0, 0], [205, 49, 49], [13, 188, 121], [229, 229, 16],
  [36, 114, 200], [188, 63, 188], [17, 168, 205], [229, 229, 229],
  [102, 102, 102], [241, 76, 76], [35, 209, 139], [245, 245, 67],
  [59, 142, 234], [214, 112, 214], [41, 184, 219], [255, 255, 255],
];

function rgbTo16(rgb) {
  let best = 0;
  let dist = Infinity;
  BASIC.forEach((c, i) => {
    const d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2;
    if (d < dist) { dist = d; best = i; }
  });
  return best;
}

/** Foreground escape sequence for a hex color in the given mode. */
export function fg(hex, mode) {
  const rgb = hexToRgb(hex);
  if (!rgb || mode === 'none') return '';
  if (mode === '256') return `\x1b[38;5;${rgbTo256(rgb)}m`;
  if (mode === '16') {
    const i = rgbTo16(rgb);
    return `\x1b[${i < 8 ? 30 + i : 90 + i - 8}m`;
  }
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

export function bold(mode) {
  return mode === 'none' ? '' : '\x1b[1m';
}

export function dim(mode) {
  return mode === 'none' ? '' : '\x1b[2m';
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function stripAnsi(s) {
  return String(s).replace(ANSI_RE, '');
}

/** Visible width in terminal cells (handles wide CJK/emoji approximately, ignores ANSI). */
export function visibleWidth(s) {
  let w = 0;
  for (const ch of stripAnsi(s)) {
    const cp = ch.codePointAt(0);
    if (cp < 32 || (cp >= 0x300 && cp <= 0x36f) || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) continue;
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff)
  );
}

/** Truncate plain text to `max` cells with an ellipsis. */
export function truncate(s, max) {
  if (max <= 0) return '';
  if (visibleWidth(s) <= max) return s;
  let out = '';
  for (const ch of s) {
    if (visibleWidth(out + ch) > max - 1) break;
    out += ch;
  }
  return out + '…';
}
