// Writes the stable entry points of a managed install:
//   <dataHome>/launcher.js   (from launcher.template.cjs)
//   <dataHome>/bin/td.cmd    Windows only: cmd / PowerShell / Windows Terminal
//   <dataHome>/bin/td        macOS / Linux / Git Bash (sh; finds node on its own)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from '../../core/src/index.js';
import { renderShimSh } from './shim-sh.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const LAUNCHER_TEMPLATE = path.join(here, 'launcher.template.cjs');

// Node search: %TD_NODE%, then the private node that get.ps1 may have put in
// <dataHome>\node\node.exe, then `node` from PATH. node is the last command, so its exit
// code becomes the exit code of td.cmd. (cmd.exe re-reads batch files while running them;
// td uninstall therefore deletes bin\ and node\ from a detached process afterwards.)
export const SHIM_CMD = [
  '@echo off',
  'rem Terminal-Design: atalho gerado pelo instalador. Nao edite.',
  'setlocal',
  'set "TD_NODE_EXE=node"',
  'if exist "%~dp0..\\node\\node.exe" set "TD_NODE_EXE=%~dp0..\\node\\node.exe"',
  'if defined TD_NODE set "TD_NODE_EXE=%TD_NODE%"',
  'if "%TD_NODE_EXE%"=="node" (where node >nul 2>nul || (echo Terminal-Design precisa do Node.js 18.17+: https://nodejs.org/pt-br/download 1>&2 & exit /b 1))',
  '"%TD_NODE_EXE%" "%~dp0..\\launcher.js" %*',
  '',
].join('\r\n');

/** Private Node.js installed by get.sh / get.ps1 (inside dataHome), or null. */
export function privateNodePath(paths, platform = process.platform) {
  const p = platform === 'win32' ? path.join(paths.dataHome, 'node', 'node.exe') : path.join(paths.dataHome, 'node', 'bin', 'node');
  return fs.existsSync(p) ? p : null;
}

/**
 * Node executable for commands written into other programs (e.g. the Claude Code status
 * line on Windows): the private node when present, otherwise plain `node` from PATH.
 */
export function nodeCommand(paths, platform = process.platform) {
  return privateNodePath(paths, platform) ?? 'node';
}

/** bin/td (sh). Kept as a constant for callers that only need the default rendering. */
export const SHIM_SH = renderShimSh();

/** The command users and integrations should run: bin\td.cmd on Windows, bin/td elsewhere. */
export function shimPath(paths, platform = process.platform) {
  return path.join(paths.binDir, platform === 'win32' ? 'td.cmd' : 'td');
}

export const MARKER_NAME = '.terminal-design';
export const LAUNCHER_HEADER = '// Terminal-Design launcher.';

export function markerFile(paths) {
  return path.join(paths.dataHome, MARKER_NAME);
}

/** Install marker (ownership proof for td uninstall, custom config home for the launcher). */
export function readMarker(paths) {
  try {
    const m = JSON.parse(fs.readFileSync(markerFile(paths), 'utf8').replace(/^\uFEFF/, ''));
    return m && m.product === 'terminal-design' ? m : null;
  } catch {
    return null;
  }
}

/**
 * Write the marker. configHome is recorded only when it is custom (TD_CONFIG_HOME was set),
 * so the launcher can pin it later; the default location needs no pinning.
 */
export function writeMarker(paths, { configHome = process.env.TD_CONFIG_HOME ? paths.configHome : null } = {}) {
  const prev = readMarker(paths);
  writeFileAtomic(markerFile(paths), JSON.stringify({
    product: 'terminal-design',
    format: 1,
    installedAt: prev?.installedAt ?? new Date().toISOString(),
    configHome: configHome ?? null,
  }, null, 2) + '\n');
}

/**
 * (Re)write launcher.js, the bin shims and the marker. Returns the written paths.
 * opts: { platform, recordedNode (absolute node for the sh shim), configHome (marker) }
 */
export function writeLauncherFiles(paths, opts = {}) {
  const platform = opts.platform ?? process.platform;
  writeFileAtomic(paths.launcher, fs.readFileSync(LAUNCHER_TEMPLATE));
  // launcher.js is CommonJS; pin that so a stray {"type":"module"} package.json in a
  // parent folder (e.g. the user's home) can never change how it loads.
  writeFileAtomic(path.join(paths.dataHome, 'package.json'), '{\n  "private": true,\n  "type": "commonjs"\n}\n');
  const sh = path.join(paths.binDir, 'td');
  // Windows: Git Bash finds node through PATH; a recorded C:\ path would only confuse MSYS.
  const recordedNode = opts.recordedNode ?? (platform === 'win32' ? '' : process.execPath);
  writeFileAtomic(sh, renderShimSh({ recordedNode }));
  try { fs.chmodSync(sh, 0o755); } catch { /* not supported (Windows) */ }
  let cmd = null;
  if (platform === 'win32') {
    cmd = path.join(paths.binDir, 'td.cmd');
    writeFileAtomic(cmd, SHIM_CMD);
  }
  const { platform: _p, recordedNode: _r, ...markerOpts } = opts;
  writeMarker(paths, markerOpts);
  return { launcher: paths.launcher, cmd, sh, shim: shimPath(paths, platform), marker: markerFile(paths) };
}

export function launcherFilesPresent(paths, platform = process.platform) {
  return fs.existsSync(paths.launcher) && fs.existsSync(shimPath(paths, platform)) && !!readMarker(paths);
}
