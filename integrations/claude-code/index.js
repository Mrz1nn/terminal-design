// Claude Code integration: installs/removes the Terminal-Design status line in
// ~/.claude/settings.json using only official settings keys (statusLine, subagentStatusLine).
// Backs up settings.json before every change and remembers what was there before,
// so uninstall restores the user's previous status line exactly.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJsonAtomic, backupFile, installMode } from '../../packages/core/src/index.js';

const MARKER = 'terminal-design';
const fwd = (p) => p.replace(/\\/g, '/');

export function settingsFile(paths) {
  return path.join(paths.claudeHome, 'settings.json');
}

function previousFile(paths) {
  return path.join(paths.dataHome, 'claude-code-previous.json');
}

/** Command Claude Code runs. Uses the stable launcher in managed installs. */
export function statusCommand(paths, sub = false) {
  const entry = installMode(paths) === 'managed' ? paths.launcher : path.join(paths.appRoot, 'bin', 'td.js');
  // The marker env var lets us recognize our own entries without guessing from paths.
  return `node "${fwd(entry)}" statusline${sub ? ' --subagent' : ''} --from=${MARKER}`;
}

export function isOurs(entry) {
  return !!entry && typeof entry.command === 'string' && entry.command.includes(`--from=${MARKER}`);
}

export function status(paths) {
  const file = settingsFile(paths);
  const s = readJson(file, {});
  return {
    settingsFile: file,
    exists: fs.existsSync(file),
    statusLine: s.statusLine ?? null,
    subagentStatusLine: s.subagentStatusLine ?? null,
    installed: isOurs(s.statusLine),
    subagentInstalled: isOurs(s.subagentStatusLine),
    foreign: !!s.statusLine && !isOurs(s.statusLine),
  };
}

export function install(paths, { subagent = true, refreshInterval = 30 } = {}) {
  const file = settingsFile(paths);
  const settings = readJson(file, {});
  const backup = backupFile(file, paths.backups, 'claude-settings.json');

  // Remember the user's own entries once, so a reinstall doesn't overwrite the real original.
  const prevFile = previousFile(paths);
  if (!fs.existsSync(prevFile)) {
    writeJsonAtomic(prevFile, {
      savedAt: new Date().toISOString(),
      statusLine: isOurs(settings.statusLine) ? null : settings.statusLine ?? null,
      subagentStatusLine: isOurs(settings.subagentStatusLine) ? null : settings.subagentStatusLine ?? null,
    });
  }

  settings.statusLine = { type: 'command', command: statusCommand(paths), refreshInterval };
  if (subagent) settings.subagentStatusLine = { type: 'command', command: statusCommand(paths, true) };
  writeJsonAtomic(file, settings);
  return { file, backup };
}

export function uninstall(paths) {
  const file = settingsFile(paths);
  if (!fs.existsSync(file)) return { file, changed: false };
  const settings = readJson(file, {});
  const prev = readJson(previousFile(paths), { statusLine: null, subagentStatusLine: null });
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
  return { file, changed, backup, restored: !!(prev.statusLine || prev.subagentStatusLine) };
}
