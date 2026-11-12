// `td voice autostart on|off|status`: start voice typing when the user signs in to Windows.
//
// Mechanism: one shortcut in the user's own Startup folder
//   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Terminal-Design voz.lnk
// No administrator rights, no registry, no scheduled task. The shortcut opens `td voice` in a
// minimized console window (it stays visible in the taskbar, so it is never a hidden process).
//
// Ownership: the shortcut has a fixed name that only Terminal-Design uses, and a small record
// (voice/autostart.json) says where it was written. `off` and `td uninstall` delete only that
// exact file. Everything that touches the system goes through `deps`, so tests use fakes.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { windowsPowerShellEnv } from '../../../packages/core/src/fs.js';

export const SHORTCUT_NAME = 'Terminal-Design voz.lnk';
export const SHORTCUT_DESCRIPTION = 'Terminal-Design: digitação por voz (td voice). Desligue com td voice autostart off.';
const RECORD_NAME = 'autostart.json';
const SW_SHOWMINNOACTIVE = 7; // shortcut "Run: Minimized"

/** The current user's Startup folder (no admin needed to write there). */
export function startupDir(env = process.env) {
  if (!env.APPDATA) throw new Error('variável APPDATA ausente: não foi possível achar a pasta Inicializar do Windows');
  return path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

export function shortcutPath(env = process.env) {
  return path.join(startupDir(env), SHORTCUT_NAME);
}

function recordFile(paths) {
  return path.join(paths.voice, RECORD_NAME);
}

/**
 * Pure: what the shortcut runs.
 *   managed install: <dataHome>\bin\td.cmd voice   (follows `td update`, never points at a version folder)
 *   git clone:       node.exe "<clone>\bin\td.js" voice
 */
export function shortcutSpec(paths, { mode, execPath = process.execPath } = {}) {
  if (mode === 'managed') {
    return {
      target: path.join(paths.binDir, 'td.cmd'),
      args: 'voice',
      workingDir: paths.dataHome,
      windowStyle: SW_SHOWMINNOACTIVE,
      description: SHORTCUT_DESCRIPTION,
    };
  }
  return {
    target: execPath,
    args: `"${path.join(paths.appRoot, 'bin', 'td.js')}" voice`,
    workingDir: paths.appRoot,
    windowStyle: SW_SHOWMINNOACTIVE,
    description: SHORTCUT_DESCRIPTION,
  };
}

/**
 * Real shortcut writer: WScript.Shell through Windows PowerShell 5.1. The values travel in
 * environment variables, never inside the script text, so no path can inject code.
 */
export function writeShortcutWindows(file, spec) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:TD_LNK_FILE)',
    '$s.TargetPath = $env:TD_LNK_TARGET',
    '$s.Arguments = $env:TD_LNK_ARGS',
    '$s.WorkingDirectory = $env:TD_LNK_DIR',
    '$s.WindowStyle = [int]$env:TD_LNK_STYLE',
    '$s.Description = $env:TD_LNK_DESC',
    '$s.Save()',
  ].join('; ');
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const r = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    env: windowsPowerShellEnv(process.env, {
      TD_LNK_FILE: file,
      TD_LNK_TARGET: spec.target,
      TD_LNK_ARGS: spec.args,
      TD_LNK_DIR: spec.workingDir,
      TD_LNK_STYLE: String(spec.windowStyle),
      TD_LNK_DESC: spec.description,
    }),
  });
  if (r.error) throw new Error(`não foi possível iniciar o PowerShell: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`não foi possível criar o atalho: ${(r.stderr || r.stdout || '').trim().split('\n')[0]}`);
}

const realDeps = { platform: process.platform, env: process.env, writeShortcut: writeShortcutWindows };

function assertWindows(platform) {
  if (platform !== 'win32') throw new Error('a inicialização automática da voz existe só no Windows');
}

/** { enabled, file, target?, createdAt? }. Reads files only. */
export function autostartStatus(paths, deps = {}) {
  const d = { ...realDeps, ...deps };
  if (d.platform !== 'win32') return { supported: false, enabled: false, file: null };
  let file;
  try { file = shortcutPath(d.env); } catch { return { supported: true, enabled: false, file: null }; }
  let record = null;
  try { record = JSON.parse(fs.readFileSync(recordFile(paths), 'utf8')); } catch { /* none */ }
  return { supported: true, enabled: fs.existsSync(file), file, target: record?.target ?? null, createdAt: record?.createdAt ?? null };
}

/** Create (or refresh) the Startup shortcut. Returns { file, spec, replaced }. */
export function enableAutostart(paths, { mode, execPath } = {}, deps = {}) {
  const d = { ...realDeps, ...deps };
  assertWindows(d.platform);
  const file = shortcutPath(d.env);
  const spec = shortcutSpec(paths, { mode, execPath });
  if (mode === 'managed' && !fs.existsSync(spec.target)) {
    throw new Error(`${spec.target} não existe; reinstale o Terminal-Design antes de ligar a inicialização automática`);
  }
  const replaced = fs.existsSync(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  d.writeShortcut(file, spec);
  if (!fs.existsSync(file)) throw new Error(`o atalho não foi criado em ${file}`);
  fs.mkdirSync(paths.voice, { recursive: true });
  fs.writeFileSync(recordFile(paths), `${JSON.stringify({ file, target: spec.target, args: spec.args, createdAt: new Date().toISOString() }, null, 2)}\n`);
  return { file, spec, replaced };
}

/**
 * Remove the Startup shortcut. Deletes only files named SHORTCUT_NAME: the one in the current
 * Startup folder and the one recorded at `on` time (if the profile moved). Never anything else.
 * Returns { removed: string[] }. Safe to call when it is off (and on non-Windows: no-op).
 */
export function disableAutostart(paths, deps = {}) {
  const d = { ...realDeps, ...deps };
  const removed = [];
  const candidates = new Set();
  if (d.platform === 'win32') {
    try { candidates.add(shortcutPath(d.env)); } catch { /* no APPDATA */ }
  }
  try {
    const rec = JSON.parse(fs.readFileSync(recordFile(paths), 'utf8'));
    if (typeof rec?.file === 'string' && path.basename(rec.file) === SHORTCUT_NAME) candidates.add(rec.file);
  } catch { /* no record */ }
  for (const f of candidates) {
    if (path.basename(f) !== SHORTCUT_NAME) continue; // defensive: never delete another name
    if (fs.existsSync(f)) { fs.rmSync(f, { force: true }); removed.push(f); }
  }
  fs.rmSync(recordFile(paths), { force: true });
  return { removed };
}
