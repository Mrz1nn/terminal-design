// Single source of truth for every location Terminal-Design reads or writes.
//
// Three zones, never mixed:
//   appRoot     program files (replaced by `td update`)
//   configHome  user configuration and user themes (never touched by updates)
//   dataHome    installed versions, backups, cache, models, launcher
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository / installed version root (folder that holds package.json). */
export const appRoot = path.resolve(here, '..', '..', '..');

const isWin = process.platform === 'win32';

function base(envName, winVar, fallbackParts) {
  if (process.env[envName]) return path.resolve(process.env[envName]);
  if (isWin && process.env[winVar]) return path.join(process.env[winVar], 'TerminalDesign');
  return path.join(os.homedir(), ...fallbackParts);
}

export function getPaths() {
  const configHome = base('TD_CONFIG_HOME', 'APPDATA', ['.config', 'terminal-design']);
  const dataHome = base('TD_DATA_HOME', 'LOCALAPPDATA', ['.local', 'share', 'terminal-design']);
  return {
    appRoot,
    configHome,
    configFile: path.join(configHome, 'config.json'),
    userThemes: path.join(configHome, 'themes'),
    builtinThemes: path.join(appRoot, 'themes'),
    dataHome,
    versions: path.join(dataHome, 'versions'),
    currentFile: path.join(dataHome, 'current.json'),
    launcher: path.join(dataHome, 'launcher.js'),
    binDir: path.join(dataHome, 'bin'),
    backups: path.join(dataHome, 'backups'),
    cache: path.join(dataHome, 'cache'),
    staging: path.join(dataHome, 'staging'),
    voice: path.join(dataHome, 'voice'),
    logs: path.join(dataHome, 'logs'),
    claudeHome: process.env.CLAUDE_CONFIG_DIR
      ? path.resolve(process.env.CLAUDE_CONFIG_DIR)
      : path.join(os.homedir(), '.claude'),
  };
}

/**
 * "managed": running from %LOCALAPPDATA%\TerminalDesign\versions\<v> (installed by install.ps1).
 * "dev": running from a git clone; `td update` tells the user to use git pull instead.
 */
export function installMode(paths = getPaths()) {
  const rel = path.relative(paths.versions, appRoot);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? 'managed' : 'dev';
}
