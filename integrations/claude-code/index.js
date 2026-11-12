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

// ---- slash commands (/tema) -------------------------------------------------------
// Files in ~/.claude/commands written by Terminal-Design carry COMMAND_MARK. A file with the
// same name but without the mark belongs to the user and is never touched.
export const COMMAND_MARK = '<!-- terminal-design:command';
/** Bump when the command text changes: existing installs pick up the new text once. */
export const COMMANDS_VERSION = 1;

/** How Claude Code should run td: same program as the status line, without the statusline tail. */
export function tdCommand(paths, platform = process.platform) {
  return statusCommand(paths, false, platform).replace(/ statusline --from=terminal-design$/, '');
}

export function commandsDir(paths) {
  return path.join(paths.claudeHome, 'commands');
}

function commandsRecord(paths) {
  return path.join(paths.dataHome, 'claude-commands.json');
}

/** Pure: file name -> content of every slash command we ship. */
export function commandFiles(paths, platform = process.platform) {
  const td = tdCommand(paths, platform);
  return {
    'tema.md': [
      '---',
      'description: Troca o tema do Terminal-Design (status line do Claude Code)',
      'argument-hint: "[nome ou número do tema]"',
      '---',
      `${COMMAND_MARK} v${COMMANDS_VERSION}: criado por td claude install; td claude uninstall remove. -->`,
      '',
      'Tema do Terminal-Design. Argumento recebido: "$ARGUMENTS".',
      '',
      `- Sem argumento: rode \`${td} theme list --no-color\` e mostre a lista numerada exatamente como veio, com o tema atual marcado. Depois pergunte qual tema a pessoa quer (nome ou número). Não aplique nada sozinho.`,
      `- Com argumento: rode \`${td} theme set $ARGUMENTS --no-color\`. Se der certo, responda em uma linha que o tema foi aplicado e que a status line muda na próxima mensagem. Se der erro, mostre o erro e a lista de temas.`,
      `- Para ver um tema antes de aplicar, a pessoa pode pedir uma prévia: \`${td} theme preview <nome ou número>\`.`,
      '',
      'Não rode nenhum outro comando nem mude outros arquivos.',
      '',
    ].join('\n'),
  };
}

function isOurCommandFile(file) {
  try { return fs.readFileSync(file, 'utf8').includes(COMMAND_MARK); } catch { return false; }
}

/** Write our slash commands. Returns { written: [], skipped: [] } (skipped = user's own file with the same name). */
export function installCommands(paths, platform = process.platform) {
  const dir = commandsDir(paths);
  const written = [];
  const skipped = [];
  for (const [name, content] of Object.entries(commandFiles(paths, platform))) {
    const file = path.join(dir, name);
    if (fs.existsSync(file) && !isOurCommandFile(file)) { skipped.push(file); continue; }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, content);
    written.push(file);
  }
  writeJsonAtomic(commandsRecord(paths), { version: COMMANDS_VERSION, files: written, at: new Date().toISOString() });
  return { written, skipped };
}

/** Remove only our own command files. */
export function removeCommands(paths) {
  const removed = [];
  for (const name of Object.keys(commandFiles(paths))) {
    const file = path.join(commandsDir(paths), name);
    if (fs.existsSync(file) && isOurCommandFile(file)) { fs.rmSync(file, { force: true }); removed.push(file); }
  }
  fs.rmSync(commandsRecord(paths), { force: true });
  return { removed };
}

/**
 * Called by the status line (cheap: one small file read). Installs or refreshes our commands once
 * per COMMANDS_VERSION when our status line is active, so `td update` users get /tema without
 * running anything. A command the user deleted is not recreated until COMMANDS_VERSION changes.
 */
export function ensureCommands(paths) {
  const rec = readJson(commandsRecord(paths), null);
  if (rec && rec.version === COMMANDS_VERSION) return false;
  const st = status(paths);
  if (st.error || !st.installed) return false;
  installCommands(paths);
  return true;
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
  let commands = { written: [], skipped: [] };
  try { commands = installCommands(paths); } catch { /* the status line works without /tema */ }
  return { file, backup, commands };
}

export function uninstall(paths) {
  const file = settingsFile(paths);
  let commands = { removed: [] };
  try { commands = removeCommands(paths); } catch { /* keep going */ }
  if (!fs.existsSync(file)) return { file, changed: commands.removed.length > 0, commands };
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
  return { file, changed: changed || commands.removed.length > 0, backup, commands, restored: changed && !!(prev.statusLine || prev.subagentStatusLine) };
}
