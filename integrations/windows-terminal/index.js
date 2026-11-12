// Windows Terminal integration through JSON fragments (official extension mechanism):
// https://learn.microsoft.com/windows/terminal/json-fragment-extensions
// We never edit the user's settings.json. The fragment adds color schemes named "TD <theme>";
// the user picks one in Settings > Profiles > Appearance > Color scheme.
//
// Isolation: when Terminal-Design runs with a custom TD_DATA_HOME (tests, sandbox installs),
// the fragment goes to <dataHome>/wt-fragments instead of the real Windows Terminal folder,
// unless TD_WT_FRAGMENTS_DIR says otherwise.
import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic, getPaths, readJson, backupFile, isPlainObject } from '../../packages/core/src/index.js';
import { listThemes, toWindowsTerminalScheme } from '../../packages/themes/src/index.js';

const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export function fragmentDir(env = process.env) {
  if (env.TD_WT_FRAGMENTS_DIR) return path.resolve(env.TD_WT_FRAGMENTS_DIR);
  if (env.TD_DATA_HOME && !(env.LOCALAPPDATA && same(env.TD_DATA_HOME, path.join(env.LOCALAPPDATA, 'TerminalDesign')))) {
    return path.join(path.resolve(env.TD_DATA_HOME), 'wt-fragments', 'TerminalDesign');
  }
  if (!env.LOCALAPPDATA) return null;
  return path.join(env.LOCALAPPDATA, 'Microsoft', 'Windows Terminal', 'Fragments', 'TerminalDesign');
}

export function isWindowsTerminalInstalled(env = process.env) {
  if (!env.LOCALAPPDATA) return false;
  const pkgs = path.join(env.LOCALAPPDATA, 'Packages');
  try {
    return fs.readdirSync(pkgs).some((d) => d.startsWith('Microsoft.WindowsTerminal'));
  } catch {
    return false;
  }
}

/** Write every valid theme as a scheme. Returns the fragment file path. */
export function syncSchemes(paths = getPaths(), env = process.env) {
  const dir = fragmentDir(env);
  if (!dir) throw new Error('LOCALAPPDATA não definido: Windows Terminal só existe no Windows');
  const schemes = listThemes(paths).filter((t) => !t.errors.length).map((t) => toWindowsTerminalScheme(t.theme));
  const file = path.join(dir, 'terminal-design.json');
  writeJsonAtomic(file, { schemes });
  return { file, count: schemes.length };
}

/** Remove only our own fragment file, then the folder if it is empty. */
export function removeSchemes(env = process.env) {
  const dir = fragmentDir(env);
  if (!dir) return;
  fs.rmSync(path.join(dir, 'terminal-design.json'), { force: true });
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch { /* folder absent */ }
}

// ---- applying a scheme to the terminal itself -----------------------------------------
// To change the terminal colors right away we set profiles.defaults.colorScheme in the user's
// Windows Terminal settings.json (WT reloads it live). Safety rules:
//   - backup first; a file with comments, invalid JSON or an unexpected shape is never written;
//   - the user's previous value is recorded once and restored by `td theme terminal off`
//     and by `td uninstall`; restore only touches the key while it still holds one of our
//     "TD ..." schemes;
//   - sandbox installs (custom TD_DATA_HOME) never touch the real settings unless
//     TD_WT_SETTINGS points at a file.

const WT_SETTINGS = [
  ['Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState', 'settings.json'],
  ['Packages', 'Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe', 'LocalState', 'settings.json'],
  ['Microsoft', 'Windows Terminal', 'settings.json'],
];

/** Windows Terminal settings.json files that exist (stable, preview, unpackaged). */
export function settingsFiles(env = process.env) {
  if (env.TD_WT_SETTINGS) return [path.resolve(env.TD_WT_SETTINGS)];
  if (env.TD_DATA_HOME && !(env.LOCALAPPDATA && same(env.TD_DATA_HOME, path.join(env.LOCALAPPDATA, 'TerminalDesign')))) return [];
  if (!env.LOCALAPPDATA) return [];
  return WT_SETTINGS.map((p) => path.join(env.LOCALAPPDATA, ...p)).filter((f) => fs.existsSync(f));
}

function previousFile(paths) {
  return path.join(paths.dataHome, 'wt-previous.json');
}

function hasComments(text) {
  // Comments outside strings: drop strings first, then look for // or /*.
  return /\/\/|\/\*/.test(text.replace(/"(?:[^"\\]|\\.)*"/g, '""'));
}

function readSettings(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  if (hasComments(text)) return { error: 'o arquivo tem comentários e não é reescrito automaticamente' };
  let s;
  try { s = JSON.parse(text); } catch (e) { return { error: `JSON inválido (${e.message})` }; }
  if (!isPlainObject(s) || (s.profiles !== undefined && !isPlainObject(s.profiles))) return { error: 'formato antigo de "profiles"' };
  return { settings: s };
}

/**
 * Make `theme` the color scheme of every Windows Terminal profile (profiles.defaults).
 * Returns { scheme, applied: [file], skipped: [{file, reason}], overridden: [profile names] }.
 */
export function applyScheme(theme, paths = getPaths(), env = process.env) {
  syncSchemes(paths, env);
  const scheme = toWindowsTerminalScheme(theme).name;
  const prev = readJson(previousFile(paths), {}) ?? {};
  const out = { scheme, applied: [], skipped: [], overridden: [] };
  for (const file of settingsFiles(env)) {
    const { settings, error } = readSettings(file);
    if (error) { out.skipped.push({ file, reason: error }); continue; }
    settings.profiles = settings.profiles ?? {};
    settings.profiles.defaults = isPlainObject(settings.profiles.defaults) ? settings.profiles.defaults : {};
    const current = settings.profiles.defaults.colorScheme;
    // Remember the user's own value once; while it is one of ours, keep the original.
    if (!(file in prev)) prev[file] = typeof current === 'string' && current.startsWith('TD ') ? null : current ?? null;
    backupFile(file, paths.backups, 'windows-terminal-settings.json');
    settings.profiles.defaults.colorScheme = scheme;
    writeJsonAtomic(file, settings);
    out.applied.push(file);
    for (const p of Array.isArray(settings.profiles.list) ? settings.profiles.list : []) {
      if (p && !p.hidden && typeof p.colorScheme === 'string' && p.colorScheme !== scheme) out.overridden.push(p.name ?? p.guid);
    }
  }
  if (out.applied.length) writeJsonAtomic(previousFile(paths), prev);
  return out;
}

/** Put back the colors the user had before applyScheme. Returns { restored: [file], skipped: [{file, reason}] }. */
export function restoreScheme(paths = getPaths(), env = process.env) {
  const prev = readJson(previousFile(paths), null);
  const out = { restored: [], skipped: [] };
  if (!isPlainObject(prev)) return out;
  for (const [file, value] of Object.entries(prev)) {
    if (!fs.existsSync(file)) continue;
    const { settings, error } = readSettings(file);
    if (error) { out.skipped.push({ file, reason: error }); continue; }
    const d = settings.profiles?.defaults;
    if (!isPlainObject(d) || typeof d.colorScheme !== 'string' || !d.colorScheme.startsWith('TD ')) continue; // user changed it since
    backupFile(file, paths.backups, 'windows-terminal-settings.json');
    if (value == null) delete d.colorScheme;
    else d.colorScheme = value;
    writeJsonAtomic(file, settings);
    out.restored.push(file);
  }
  fs.rmSync(previousFile(paths), { force: true });
  return out;
}
