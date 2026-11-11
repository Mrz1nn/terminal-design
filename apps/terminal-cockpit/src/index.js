// Terminal Cockpit: renders the Claude Code status line and agent panel rows.
// Entry points used by `td statusline` / `td statusline --subagent` (wired in integrations/claude-code).
import path from 'node:path';
import { getPaths, readJson, writeJsonAtomic } from '../../../packages/core/src/index.js';
import { loadConfig } from '../../../packages/config/src/index.js';
import { resolveTheme } from '../../../packages/themes/src/index.js';
import { renderStatusLine, renderSubagentRows } from './render.js';

export { renderStatusLine, renderSubagentRows } from './render.js';
export { normalize } from './data.js';

export function readStdin(timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    const timer = setTimeout(() => resolve(data), timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
  });
}

// The dashboard (`td` outside Claude Code) shows the last real payload Claude Code sent,
// with its age, instead of inventing numbers. Stored only on this machine.
export function lastPayloadFile(paths) {
  return path.join(paths.cache, 'last-statusline.json');
}

function saveLastPayload(paths, raw) {
  try {
    writeJsonAtomic(lastPayloadFile(paths), { receivedAt: Date.now(), payload: raw });
  } catch { /* best effort */ }
}

export function readLastPayload(paths) {
  return readJson(lastPayloadFile(paths), null);
}

function safeTheme(config, paths) {
  try {
    return resolveTheme(config, paths);
  } catch {
    return resolveTheme({ theme: { name: 'midnight', overrides: {} } }, paths);
  }
}

async function updateNotice(config) {
  if (config.update.auto === 'off') return null;
  try {
    const mod = await import('../../../packages/updater/src/index.js');
    // Must be cache-only (no network) so the status line never waits on GitHub.
    return typeof mod.getUpdateNotice === 'function' ? await mod.getUpdateNotice({ config, offline: true }) : null;
  } catch {
    return null;
  }
}

export async function runStatusLine({ subagent = false } = {}) {
  const paths = getPaths();
  const config = loadConfig(paths);
  const theme = safeTheme(config, paths);
  const text = await readStdin();
  let raw = {};
  try {
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    process.stdout.write('terminal-design: JSON inválido recebido do Claude Code');
    return 0;
  }
  if (!subagent && raw.session_id) saveLastPayload(paths, raw);
  const out = subagent
    ? renderSubagentRows(raw, { config, theme })
    : renderStatusLine(raw, { config, theme, paths, updateNotice: await updateNotice(config) });
  process.stdout.write(out);
  return 0;
}
