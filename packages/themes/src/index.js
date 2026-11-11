// Theme engine. A theme is pure data (JSON); nothing here knows about widgets or Claude Code.
// Built-in themes live in <appRoot>/themes, user themes in <configHome>/themes.
// User themes with the same name override built-ins.
import fs from 'node:fs';
import path from 'node:path';
import { getPaths, readJson, writeJsonAtomic, deepMerge, isPlainObject, hexToRgb } from '../../core/src/index.js';

export const PALETTE_KEYS = ['background', 'foreground', 'primary', 'secondary', 'accent', 'success', 'warning', 'error', 'muted', 'surface'];
export const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];
export const BORDERS = {
  rounded: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
  square: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
  heavy: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' },
  double: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' },
  ascii: { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' },
  none: { tl: '', tr: '', bl: '', br: '', h: '', v: '' },
};

/** Style defaults every theme inherits. */
export const DEFAULT_STYLE = Object.freeze({
  bar: { filled: '▰', empty: '▱', width: 10 },
  separator: ' │ ',
  groupGap: '  ',
  border: 'rounded',
  // Context/usage thresholds (percent) that switch bar color to warning / error.
  thresholds: { warning: 60, error: 85 },
});

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function validateTheme(t) {
  const errors = [];
  if (!isPlainObject(t)) return ['tema precisa ser um objeto JSON'];
  if (!NAME_RE.test(t.name ?? '')) errors.push('name: use letras minúsculas, números e hífen (ex.: "meu-tema")');
  if (!isPlainObject(t.palette)) errors.push('palette: obrigatório');
  else for (const k of PALETTE_KEYS) if (!hexToRgb(t.palette[k])) errors.push(`palette.${k}: cor hex #rrggbb obrigatória`);
  if (t.ansi !== undefined) {
    if (!isPlainObject(t.ansi)) errors.push('ansi: precisa ser um objeto');
    else for (const k of ANSI_KEYS) if (t.ansi[k] !== undefined && !hexToRgb(t.ansi[k])) errors.push(`ansi.${k}: cor hex inválida`);
  }
  const border = t.style?.border;
  if (border !== undefined && !BORDERS[border]) errors.push(`style.border: use ${Object.keys(BORDERS).join(', ')}`);
  const w = t.style?.bar?.width;
  if (w !== undefined && !(Number.isInteger(w) && w >= 3 && w <= 40)) errors.push('style.bar.width: inteiro entre 3 e 40');
  return errors;
}

function readThemeDir(dir, origin) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.schema.json'))
    .map((f) => {
      const file = path.join(dir, f);
      try {
        const t = readJson(file);
        const errors = validateTheme(t);
        return { name: t.name ?? path.basename(f, '.json'), displayName: t.displayName ?? t.name, origin, file, theme: t, errors };
      } catch (err) {
        return { name: path.basename(f, '.json'), displayName: f, origin, file, theme: null, errors: [err.message] };
      }
    });
}

/** All themes; user themes shadow built-ins with the same name. */
export function listThemes(paths = getPaths()) {
  const map = new Map();
  for (const t of readThemeDir(paths.builtinThemes, 'builtin')) map.set(t.name, t);
  for (const t of readThemeDir(paths.userThemes, 'user')) map.set(t.name, t);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function loadTheme(name, paths = getPaths()) {
  const entry = listThemes(paths).find((t) => t.name === name);
  if (!entry) throw new Error(`tema não encontrado: ${name}`);
  if (entry.errors.length) throw new Error(`tema ${name} inválido:\n  ${entry.errors.join('\n  ')}`);
  return entry.theme;
}

/** Fill derived values so consumers never deal with missing keys. */
export function normalizeTheme(t) {
  const style = deepMerge(structuredClone(DEFAULT_STYLE), t.style ?? {});
  const p = t.palette;
  const ansi = {
    black: p.surface, red: p.error, green: p.success, yellow: p.warning, blue: p.primary,
    magenta: p.secondary, cyan: p.accent, white: p.foreground,
    brightBlack: p.muted, brightRed: p.error, brightGreen: p.success, brightYellow: p.warning,
    brightBlue: p.primary, brightMagenta: p.secondary, brightCyan: p.accent, brightWhite: p.foreground,
    ...(t.ansi ?? {}),
  };
  return { ...t, palette: { ...p }, ansi, style, borderChars: BORDERS[style.border] ?? BORDERS.rounded };
}

/** Theme selected in config, with config.theme.overrides applied. */
export function resolveTheme(config, paths = getPaths()) {
  const base = loadTheme(config.theme?.name ?? 'midnight', paths);
  const merged = deepMerge(structuredClone(base), config.theme?.overrides ?? {});
  const errors = validateTheme(merged);
  if (errors.length) throw new Error(`personalização do tema inválida:\n  ${errors.join('\n  ')}`);
  return normalizeTheme(merged);
}

/** Copy a theme file into the user theme folder after validation. */
export function importTheme(file, paths = getPaths(), { force = false } = {}) {
  const t = readJson(file);
  const errors = validateTheme(t);
  if (errors.length) throw new Error(`arquivo de tema inválido:\n  ${errors.join('\n  ')}`);
  const dest = path.join(paths.userThemes, `${t.name}.json`);
  if (fs.existsSync(dest) && !force) throw new Error(`já existe um tema do usuário chamado "${t.name}" (use --force para substituir)`);
  writeJsonAtomic(dest, t);
  return { name: t.name, file: dest };
}

/** Export a theme (with optional overrides baked in) as a standalone JSON file. */
export function exportTheme(name, outFile, { config, paths = getPaths(), as } = {}) {
  let t = loadTheme(name, paths);
  if (config && config.theme?.name === name) t = deepMerge(structuredClone(t), config.theme.overrides ?? {});
  if (as) t = { ...t, name: as, displayName: as };
  const { $schema, ...clean } = t;
  writeJsonAtomic(outFile, clean);
  return outFile;
}

/** Windows Terminal "schemes" entry. */
export function toWindowsTerminalScheme(theme) {
  const t = normalizeTheme(theme);
  return {
    name: `TD ${t.displayName ?? t.name}`,
    background: t.palette.background,
    foreground: t.palette.foreground,
    cursorColor: t.palette.primary,
    selectionBackground: t.palette.surface,
    ...Object.fromEntries(ANSI_KEYS.map((k) => [k === 'magenta' ? 'purple' : k === 'brightMagenta' ? 'brightPurple' : k, t.ansi[k]])),
  };
}

/** VS Code `workbench.colorCustomizations` for the integrated terminal. */
export function toVSCodeColors(theme) {
  const t = normalizeTheme(theme);
  const cap = (k) => k[0].toUpperCase() + k.slice(1);
  const out = {
    'terminal.background': t.palette.background,
    'terminal.foreground': t.palette.foreground,
    'terminalCursor.foreground': t.palette.primary,
    'terminal.selectionBackground': `${t.palette.surface}`,
  };
  for (const k of ANSI_KEYS) out[`terminal.ansi${cap(k)}`] = t.ansi[k];
  return out;
}
