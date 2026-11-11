// User PATH (HKCU\Environment\Path) management. No admin rights needed.
//
// Reads the raw value (without expanding %VARS%) and writes it back as REG_EXPAND_SZ, so
// entries like %USERPROFILE%\bin survive; then broadcasts the change through
// [Environment]::SetEnvironmentVariable(..., 'User') so new terminals pick it up.
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function norm(p, env = process.env) {
  const expanded = String(p).replace(/%([^%]+)%/g, (m, k) => env[k] ?? env[Object.keys(env).find((x) => x.toLowerCase() === k.toLowerCase())] ?? m);
  return path.win32.normalize(expanded).replace(/\\+$/, '').toLowerCase();
}

export function pathHas(pathValue, dir, env) {
  const t = norm(dir, env);
  return String(pathValue ?? '').split(';').some((p) => p.trim() && norm(p.trim(), env) === t);
}

/** Pure: PATH string with `dir` appended (unchanged when already present). */
export function addToPathString(pathValue, dir, env) {
  if (pathHas(pathValue, dir, env)) return String(pathValue ?? '');
  const parts = String(pathValue ?? '').split(';').filter((p) => p.trim());
  parts.push(dir);
  return parts.join(';');
}

/** Pure: PATH string without any entry equal to `dir`. */
export function removeFromPathString(pathValue, dir, env) {
  const t = norm(dir, env);
  return String(pathValue ?? '').split(';').filter((p) => p.trim() && norm(p.trim(), env) !== t).join(';');
}

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

/** Is `dir` in the persisted user PATH? true / false / null (unknown). */
export function userPathHas(dir) {
  const r = runPs('query', dir);
  return r.ok ? r.result === 'present' : null;
}

/** Add `dir` to the user PATH. {ok, result: 'changed'|'unchanged'|'error'|'unsupported'} */
export function addUserPath(dir) {
  return runPs('add', dir);
}

export function removeUserPath(dir) {
  return runPs('remove', dir);
}
