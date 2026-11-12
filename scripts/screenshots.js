#!/usr/bin/env node
// Generates the README images (docs/images/*.svg) from the REAL status line renderer:
// the same code that runs inside Claude Code, fed with the labeled example payload
// (packages/cli/src/sample.js). ANSI 24-bit color output is converted to SVG text.
//
//   node scripts/screenshots.js
//
// Re-run after changing themes or widgets; the images are committed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderStatusLine } from '../apps/terminal-cockpit/src/index.js';
import { DEFAULTS } from '../packages/config/src/defaults.js';
import { listThemes, normalizeTheme } from '../packages/themes/src/index.js';
import { getPaths } from '../packages/core/src/index.js';
import { SAMPLE_PAYLOAD } from '../packages/cli/src/sample.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'images');
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const SIZE = 14;
const CELL = 8.45; // width of one monospace column at 14px
const LINE = 22;
const PAD = 18;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One ANSI line -> [{text, color, bold, dim}] (SGR 0/1/2/22/39 and 38;2;r;g;b; OSC 8 links dropped). */
export function parseAnsi(line, defaultColor) {
  const clean = line.replace(/\x1b\]8;;[^\x07]*\x07/g, '');
  const out = [];
  let style = { color: defaultColor, bold: false, dim: false };
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  const push = (text) => { if (text) out.push({ text, ...style }); };
  while ((m = re.exec(clean))) {
    push(clean.slice(last, m.index));
    last = re.lastIndex;
    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) style = { color: defaultColor, bold: false, dim: false };
      else if (c === 1) style = { ...style, bold: true };
      else if (c === 2) style = { ...style, dim: true };
      else if (c === 22) style = { ...style, bold: false, dim: false };
      else if (c === 39) style = { ...style, color: defaultColor };
      else if (c === 38 && codes[i + 1] === 2) {
        const [r, g, b] = codes.slice(i + 2, i + 5);
        style = { ...style, color: `rgb(${r},${g},${b})` };
        i += 4;
      }
    }
  }
  push(clean.slice(last));
  return out;
}

function textLine(segments, x, y) {
  const spans = segments.map((s) => {
    const attrs = [`fill="${s.color}"`];
    if (s.bold) attrs.push('font-weight="700"');
    if (s.dim) attrs.push('opacity="0.6"');
    return `<tspan ${attrs.join(' ')}>${esc(s.text)}</tspan>`;
  }).join('');
  return `<text x="${x}" y="${y}" xml:space="preserve">${spans}</text>`;
}

function render(themeEntry, extra = {}) {
  const theme = normalizeTheme(themeEntry.theme);
  const config = structuredClone(DEFAULTS);
  config.theme = { name: themeEntry.name, overrides: {} };
  return renderStatusLine(SAMPLE_PAYLOAD, {
    config, theme, git: SAMPLE_PAYLOAD._git, width: 104, colorMode: 'truecolor', now: SAMPLE_PAYLOAD._now, ...extra,
  }).split('\n');
}

function svg(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}" font-size="${SIZE}">\n${body}\n</svg>\n`;
}

const themes = listThemes(getPaths()).filter((t) => !t.errors.length);
// Fit the images to the widest rendered line (plus the /tema illustration text).
const visible = (line) => parseAnsi(line, '').map((x) => x.text).join('').length;
const cols = Math.max(84, ...themes.flatMap((t) => render(t, { updateNotice: { version: '0.4.0', current: '0.3.3', url: null, command: '/td atualizar', mode: 'managed' } }).map(visible)));
const width = Math.ceil(PAD * 2 + cols * CELL);
fs.mkdirSync(outDir, { recursive: true });

// 1. Gallery: every theme on its own background.
{
  const blockH = PAD + LINE * 3 + 6;
  const parts = [];
  themes.forEach((t, i) => {
    const th = normalizeTheme(t.theme);
    const y0 = i * blockH;
    parts.push(`<rect x="0" y="${y0}" width="${width}" height="${blockH}" fill="${th.palette.background}"/>`);
    parts.push(`<text x="${PAD}" y="${y0 + PAD + 2}" fill="${th.palette.muted}" font-size="12">${esc(`${i + 1}  ${t.displayName ?? t.name}  (/tema ${i + 1})`)}</text>`);
    render(t).forEach((line, j) => parts.push(textLine(parseAnsi(line, th.palette.foreground), PAD, y0 + PAD + LINE * (j + 1) + 4)));
  });
  fs.writeFileSync(path.join(outDir, 'temas.svg'), svg(width, themes.length * blockH, parts.join('\n')));
}

// 2. Update button as users see it inside Claude Code.
{
  const t = themes.find((x) => x.name === 'midnight') ?? themes[0];
  const th = normalizeTheme(t.theme);
  const notice = { version: '0.4.0', current: '0.3.3', url: null, command: '/td atualizar', mode: 'managed' };
  const lines = render(t, { updateNotice: notice });
  const h = PAD * 2 + LINE * lines.length;
  const parts = [`<rect width="${width}" height="${h}" rx="10" fill="${th.palette.background}"/>`];
  lines.forEach((line, j) => parts.push(textLine(parseAnsi(line, th.palette.foreground), PAD, PAD + LINE * j + 14)));
  fs.writeFileSync(path.join(outDir, 'atualizacao.svg'), svg(width, h, parts.join('\n')));
}

// 3. The /tema command in a Claude Code-like window (illustration, labeled as such).
{
  const t = themes.find((x) => x.name === 'tokyo-night') ?? themes[0];
  const th = normalizeTheme(t.theme);
  const p = th.palette;
  const chat = [
    [{ text: '> ', color: p.muted }, { text: '/tema 10 terminal', color: p.foreground, bold: true }],
    [],
    [{ text: '● ', color: p.success }, { text: 'Tokyo Night aplicado na status line e em todos os perfis do Windows Terminal.', color: p.foreground }],
    [{ text: '  /tema terminal off', color: p.accent }, { text: ' volta às cores de antes.', color: p.muted }],
    [],
  ];
  const status = render(t);
  const h = PAD * 2 + LINE * (chat.length + status.length) + 30;
  const parts = [
    `<rect width="${width}" height="${h}" rx="10" fill="${p.background}"/>`,
    `<text x="${width - PAD}" y="${PAD + 4}" fill="${p.muted}" font-size="11" text-anchor="end">ilustração · Claude Code</text>`,
  ];
  chat.forEach((segs, j) => parts.push(textLine(segs.map((s) => ({ bold: false, dim: false, ...s })), PAD, PAD + 18 + LINE * j)));
  const sy = PAD + 18 + LINE * chat.length;
  parts.push(`<line x1="${PAD}" x2="${width - PAD}" y1="${sy - 14}" y2="${sy - 14}" stroke="${p.surface}"/>`);
  status.forEach((line, j) => parts.push(textLine(parseAnsi(line, p.foreground), PAD, sy + 6 + LINE * j)));
  fs.writeFileSync(path.join(outDir, 'tema.svg'), svg(width, h, parts.join('\n')));
}

console.log(`imagens em ${path.relative(root, outDir)}: temas.svg, atualizacao.svg, tema.svg`);
