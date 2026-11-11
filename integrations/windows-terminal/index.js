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
import { writeJsonAtomic, getPaths } from '../../packages/core/src/index.js';
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
