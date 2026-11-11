// Windows Terminal integration through JSON fragments (official extension mechanism):
// https://learn.microsoft.com/windows/terminal/json-fragment-extensions
// We never edit the user's settings.json. The fragment adds color schemes named "TD <theme>";
// the user picks one in Settings > Profiles > Appearance > Color scheme.
import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from '../../packages/core/src/index.js';
import { listThemes, toWindowsTerminalScheme } from '../../packages/themes/src/index.js';

export function fragmentDir(env = process.env) {
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
export function syncSchemes(paths, env = process.env) {
  const dir = fragmentDir(env);
  if (!dir) throw new Error('LOCALAPPDATA não definido: Windows Terminal só existe no Windows');
  const schemes = listThemes(paths).filter((t) => !t.errors.length).map((t) => toWindowsTerminalScheme(t.theme));
  const file = path.join(dir, 'terminal-design.json');
  writeJsonAtomic(file, { schemes });
  return { file, count: schemes.length };
}

export function removeSchemes(env = process.env) {
  const dir = fragmentDir(env);
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}
