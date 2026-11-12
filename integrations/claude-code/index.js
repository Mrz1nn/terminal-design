// Claude Code integration: installs/removes the Terminal-Design status line in
// ~/.claude/settings.json using only official settings keys (statusLine, subagentStatusLine).
// Backs up settings.json before every change and remembers what was there before,
// so uninstall restores the user's previous status line exactly.
// A settings.json that does not parse is never modified.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, readJsonForUpdate, writeJsonAtomic, backupFile, installMode, isPlainObject } from '../../packages/core/src/index.js';
import { nodeCommand } from '../../packages/updater/src/launcher.js';

const MARKER = 'terminal-design';
const fwd = (p) => p.replace(/\\/g, '/');

export function settingsFile(paths) {
  return path.join(paths.claudeHome, 'settings.json');
}

function previousFile(paths) {
  return path.join(paths.dataHome, 'claude-code-previous.json');
}

/**
 * Command Claude Code runs.
 * - Windows managed install: node (the private copy from get.ps1 when present) + the stable launcher.
 * - macOS / Linux managed install: the bin/td shell shim, which finds node by itself.
 *   Claude Code runs the command in a non-interactive shell that often lacks nvm/Homebrew in PATH,
 *   so a bare `node` could fail there.
 * - Dev (git clone): node + bin/td.js from the clone.
 */
export function statusCommand(paths, sub = false, platform = process.platform) {
  const tail = `statusline${sub ? ' --subagent' : ''} --from=${MARKER}`;
  if (installMode(paths) === 'managed') {
    if (platform !== 'win32') return `"${fwd(path.join(paths.binDir, 'td'))}" ${tail}`;
    const node = nodeCommand(paths, platform);
    return `${node === 'node' ? 'node' : `"${fwd(node)}"`} "${fwd(paths.launcher)}" ${tail}`;
  }
  // The --from marker lets us recognize our own entries without guessing from paths.
  return `node "${fwd(path.join(paths.appRoot, 'bin', 'td.js'))}" ${tail}`;
}

export function isOurs(entry) {
  return !!entry && typeof entry.command === 'string' && entry.command.includes(`--from=${MARKER}`);
}

export function status(paths) {
  const file = settingsFile(paths);
  let s = {};
  let error = null;
  try {
    s = readJsonForUpdate(file, {});
  } catch (err) {
    error = err.message;
  }
  return {
    settingsFile: file,
    exists: fs.existsSync(file),
    error,
    statusLine: s.statusLine ?? null,
    subagentStatusLine: s.subagentStatusLine ?? null,
    installed: isOurs(s.statusLine),
    subagentInstalled: isOurs(s.subagentStatusLine),
    foreign: !!s.statusLine && !isOurs(s.statusLine),
  };
}

export function install(paths, { subagent = true, refreshInterval = 30 } = {}) {
  const file = settingsFile(paths);
  const settings = readJsonForUpdate(file, {}); // throws on a broken file: nothing is written
  const backup = backupFile(file, paths.backups, 'claude-settings.json');

  // Remember the user's own entries. A foreign entry always refreshes the saved copy, so
  // a status line the user configured after our first install is the one restored later.
  const prevFile = previousFile(paths);
  const saved = readJson(prevFile, null);
  const prev = isPlainObject(saved) ? saved : { statusLine: null, subagentStatusLine: null };
  for (const key of ['statusLine', 'subagentStatusLine']) {
    if (!settings[key]) prev[key] = null; // user has none now: restore none
    else if (!isOurs(settings[key])) prev[key] = settings[key]; // newest foreign entry wins
    else prev[key] = prev[key] ?? null; // ours already: keep what was saved
  }
  writeJsonAtomic(prevFile, { ...prev, savedAt: new Date().toISOString() });

  settings.statusLine = { type: 'command', command: statusCommand(paths), refreshInterval };
  if (subagent) settings.subagentStatusLine = { type: 'command', command: statusCommand(paths, true) };
  writeJsonAtomic(file, settings);
  return { file, backup };
}

export function uninstall(paths) {
  const file = settingsFile(paths);
  if (!fs.existsSync(file)) return { file, changed: false };
  const settings = readJsonForUpdate(file, {});
  const saved = readJson(previousFile(paths), null);
  const prev = isPlainObject(saved) ? saved : { statusLine: null, subagentStatusLine: null };
  let changed = false;
  for (const key of ['statusLine', 'subagentStatusLine']) {
    if (isOurs(settings[key])) {
      if (prev[key]) settings[key] = prev[key];
      else delete settings[key];
      changed = true;
    }
  }
  let backup = null;
  if (changed) {
    backup = backupFile(file, paths.backups, 'claude-settings.json');
    writeJsonAtomic(file, settings);
  }
  fs.rmSync(previousFile(paths), { force: true });
  return { file, changed, backup, restored: changed && !!(prev.statusLine || prev.subagentStatusLine) };
}
