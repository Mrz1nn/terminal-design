// User PATH management, no admin rights needed. Same API on every platform:
//   addUserPath(dir, opts)  removeUserPath(dir, opts)  userPathHas(dir, opts)
//
// Windows: HKCU\Environment\Path. Reads the raw value (without expanding %VARS%) and writes
// it back as REG_EXPAND_SZ, so entries like %USERPROFILE%\bin survive; then broadcasts the
// change through [Environment]::SetEnvironmentVariable(..., 'User').
//
// macOS / Linux: a clearly marked block in the shell profile files (see PROFILE_BEGIN).
// Each file is backed up before it is edited; the block is never duplicated, and uninstall
// removes exactly that block and nothing else. Uses $HOME (or opts.home in tests).
//
// opts: { platform, home, backupDir, env }  (all optional)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { backupFile } from '../../core/src/index.js';

// ---------- Windows-style PATH strings (pure) ----------

function norm(p, env = process.env) {
  const expanded = String(p).replace(/%([^%]+)%/g, (m, k) => env[k] ?? env[Object.keys(env).find((x) => x.toLowerCase() === k.toLowerCase())] ?? m);
  return path.win32.normalize(expanded).replace(/\\+$/, '').toLowerCase();
}

function posixNorm(p) {
  const s = String(p).trim();
  return s.length > 1 ? s.replace(/\/+$/, '') : s;
}

/** Does a PATH value contain `dir`? Windows: ';', case-insensitive, %VARS%. Posix: ':', exact. */
export function pathHas(pathValue, dir, env, platform = process.platform) {
  if (platform !== 'win32') {
    const t = posixNorm(dir);
    return String(pathValue ?? '').split(':').some((p) => p && posixNorm(p) === t);
  }
  const t = norm(dir, env);
  return String(pathValue ?? '').split(';').some((p) => p.trim() && norm(p.trim(), env) === t);
}

/** Pure (Windows format): PATH string with `dir` appended (unchanged when already present). */
export function addToPathString(pathValue, dir, env) {
  if (pathHas(pathValue, dir, env, 'win32')) return String(pathValue ?? '');
  const parts = String(pathValue ?? '').split(';').filter((p) => p.trim());
  parts.push(dir);
  return parts.join(';');
}

/** Pure (Windows format): PATH string without any entry equal to `dir`. */
export function removeFromPathString(pathValue, dir, env) {
  const t = norm(dir, env);
  return String(pathValue ?? '').split(';').filter((p) => p.trim() && norm(p.trim(), env) !== t).join(';');
}

// ---------- macOS / Linux: marked block in shell profiles ----------

export const PROFILE_BEGIN = '# >>> terminal-design >>>';
export const PROFILE_END = '# <<< terminal-design <<<';

/** Single-quote for sh/zsh/bash/fish. */
export function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function fishQuote(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** The block written to sh-family profiles. Prepends `dir` to PATH once per shell. */
export function profileBlock(dir) {
  return [
    PROFILE_BEGIN,
    '# Adicionado pelo instalador do Terminal-Design. Para remover: td uninstall',
    `td_bin=${shQuote(dir)}`,
    'case ":$PATH:" in',
    '  *":$td_bin:"*) ;;',
    '  *) PATH="$td_bin:$PATH"; export PATH ;;',
    'esac',
    'unset td_bin',
    PROFILE_END,
  ].join('\n');
}

export function fishBlock(dir) {
  return [
    PROFILE_BEGIN,
    '# Adicionado pelo instalador do Terminal-Design. Para remover: td uninstall',
    `if not contains -- ${fishQuote(dir)} $PATH`,
    `    set -gx PATH ${fishQuote(dir)} $PATH`,
    'end',
    PROFILE_END,
  ].join('\n');
}

/**
 * Profile files we write to.
 *   macOS: ~/.zshrc (created if missing; zsh is the default shell) + ~/.bash_profile if it exists.
 *   Linux: ~/.bashrc and ~/.zshrc if they exist; ~/.profile when neither exists.
 *   Both:  ~/.config/fish/conf.d/terminal-design.fish when ~/.config/fish exists.
 * Returns [{ file, kind: 'sh' | 'fish', create }].
 */
export function profileTargets({ platform = process.platform, home = os.homedir() } = {}) {
  const f = (n) => path.join(home, n);
  const exists = (p) => fs.existsSync(p);
  const out = [];
  if (platform === 'darwin') {
    out.push({ file: f('.zshrc'), kind: 'sh', create: true });
    if (exists(f('.bash_profile'))) out.push({ file: f('.bash_profile'), kind: 'sh', create: false });
  } else {
    for (const n of ['.bashrc', '.zshrc']) if (exists(f(n))) out.push({ file: f(n), kind: 'sh', create: false });
    if (!out.length) out.push({ file: f('.profile'), kind: 'sh', create: true });
  }
  const fishDir = path.join(home, '.config', 'fish');
  if (exists(fishDir)) out.push({ file: path.join(fishDir, 'conf.d', 'terminal-design.fish'), kind: 'fish', create: true });
  return out;
}

/** Every file that could hold our block (for removal / query), whether we would write it or not. */
function allProfileFiles(home) {
  return ['.zshrc', '.bash_profile', '.bashrc', '.profile', '.zprofile']
    .map((n) => path.join(home, n))
    .concat(path.join(home, '.config', 'fish', 'conf.d', 'terminal-design.fish'));
}

/**
 * Pure: text with our block(s) removed, plus the one blank line upsert put before it, so
 * add + remove gives back the original file. An unterminated begin marker is left alone.
 */
export function stripProfileBlock(text) {
  const lines = String(text).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === PROFILE_BEGIN) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== PROFILE_END) j++;
      if (j < lines.length) {
        if (out.length && out[out.length - 1].trim() === '') out.pop();
        i = j;
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

/** Pure: text with exactly one up-to-date block at the end. */
export function upsertProfileBlock(text, block) {
  const base = stripProfileBlock(String(text ?? '')).replace(/\s*$/, '');
  return `${base ? `${base}\n\n` : ''}${block}\n`;
}

/** Write through symlinks (dotfile managers) and keep the file mode. */
function writeProfile(file, text) {
  let target = file;
  try { target = fs.realpathSync(file); } catch { /* new file */ }
  let mode = null;
  try { mode = fs.statSync(target).mode & 0o777; } catch { /* new file */ }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.td-${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, mode != null ? { mode } : undefined);
  if (mode != null) { try { fs.chmodSync(tmp, mode); } catch { /* best effort */ } }
  fs.renameSync(tmp, target);
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function backup(file, backupDir) {
  if (!backupDir) return null;
  return backupFile(file, backupDir, `profile${path.basename(file)}`);
}

export function addProfilePath(dir, { platform = process.platform, home = os.homedir(), backupDir = null } = {}) {
  const files = [];
  const backups = [];
  for (const t of profileTargets({ platform, home })) {
    const current = readText(t.file);
    if (current == null && !t.create) continue;
    const block = t.kind === 'fish' ? fishBlock(dir) : profileBlock(dir);
    const next = upsertProfileBlock(current ?? '', block);
    if (next === current) continue;
    if (current != null) { const b = backup(t.file, backupDir); if (b) backups.push(b); }
    writeProfile(t.file, next);
    files.push(t.file);
  }
  return { ok: true, result: files.length ? 'changed' : 'unchanged', files, backups };
}

export function removeProfilePath(dir, { home = os.homedir(), backupDir = null } = {}) {
  const files = [];
  const backups = [];
  for (const file of allProfileFiles(home)) {
    const current = readText(file);
    if (current == null || !current.includes(PROFILE_BEGIN)) continue;
    const b = backup(file, backupDir);
    if (b) backups.push(b);
    const next = stripProfileBlock(current);
    if (file.endsWith('terminal-design.fish') && !next.trim()) fs.rmSync(file, { force: true });
    else writeProfile(file, next);
    files.push(file);
  }
  return { ok: true, result: files.length ? 'changed' : 'unchanged', files, backups };
}

/** Files that currently contain our block. */
export function profilesWithBlock({ home = os.homedir() } = {}) {
  return allProfileFiles(home).filter((f) => (readText(f) ?? '').includes(PROFILE_BEGIN));
}

// ---------- Windows registry ----------

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$dir = $env:TD_PATH_DIR.TrimEnd('\\')
$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
$raw = [string]$k.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
function N([string]$p) { ([Environment]::ExpandEnvironmentVariables($p)).TrimEnd('\\').ToLowerInvariant() }
$t = N $dir
$parts = @($raw -split ';' | Where-Object { $_.Trim() -ne '' })
$has = @($parts | Where-Object { (N $_) -eq $t }).Count -gt 0
switch ($env:TD_PATH_ACTION) {
  'query' { if ($has) { 'present' } else { 'absent' }; $k.Close(); exit 0 }
  'add' { if ($has) { 'unchanged'; $k.Close(); exit 0 }; $parts += $dir }
  'remove' { if (-not $has) { 'unchanged'; $k.Close(); exit 0 }; $parts = @($parts | Where-Object { (N $_) -ne $t }) }
  default { throw 'acao invalida' }
}
$k.SetValue('Path', ($parts -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
$k.Close()
[Environment]::SetEnvironmentVariable('TD_PATH_REFRESH', '1', 'User')
[Environment]::SetEnvironmentVariable('TD_PATH_REFRESH', $null, 'User')
'changed'
`;

function runPs(action, dir) {
  if (process.platform !== 'win32') return { ok: false, result: 'unsupported' };
  const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    env: { ...process.env, TD_PATH_ACTION: action, TD_PATH_DIR: dir },
  });
  const out = (r.stdout || '').trim().split(/\r?\n/).pop();
  if (r.status !== 0 || !['present', 'absent', 'unchanged', 'changed'].includes(out)) {
    return { ok: false, result: 'error', detail: (r.stderr || r.error?.message || '').trim().split(/\r?\n/)[0] };
  }
  return { ok: true, result: out };
}

// ---------- public, platform-agnostic API ----------

function guard(fn) {
  try { return fn(); } catch (err) { return { ok: false, result: 'error', detail: err.code || err.message }; }
}

/** Is `dir` in the persisted user PATH (registry / profile block)? true / false / null (unknown). */
export function userPathHas(dir, { platform = process.platform, home } = {}) {
  if (platform !== 'win32') {
    try { return profilesWithBlock({ home: home ?? os.homedir() }).length > 0; } catch { return null; }
  }
  const r = runPs('query', dir);
  return r.ok ? r.result === 'present' : null;
}

/** Add `dir` to the user PATH. {ok, result: 'changed'|'unchanged'|'error'|'unsupported', files?} */
export function addUserPath(dir, { platform = process.platform, home, backupDir } = {}) {
  if (platform !== 'win32') return guard(() => addProfilePath(dir, { platform, home: home ?? os.homedir(), backupDir }));
  return runPs('add', dir);
}

export function removeUserPath(dir, { platform = process.platform, home, backupDir } = {}) {
  if (platform !== 'win32') return guard(() => removeProfilePath(dir, { home: home ?? os.homedir(), backupDir }));
  return runPs('remove', dir);
}
