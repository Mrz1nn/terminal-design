// Writes the stable entry points of a managed install:
//   <dataHome>\launcher.js   (from launcher.template.cjs)
//   <dataHome>\bin\td.cmd    cmd / PowerShell / Windows Terminal
//   <dataHome>\bin\td        Git Bash / MSYS
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from '../../core/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const LAUNCHER_TEMPLATE = path.join(here, 'launcher.template.cjs');

// node is the last command, so its exit code becomes the exit code of td.cmd.
// (cmd.exe re-reads batch files while running them; td uninstall therefore deletes
// bin\ from a detached process after td.cmd has finished.)
export const SHIM_CMD = [
  '@echo off',
  'rem Terminal-Design: atalho gerado pelo instalador. Nao edite.',
  'where node >nul 2>nul || (echo Terminal-Design precisa do Node.js 18.17+: https://nodejs.org/pt-br/download 1>&2 & exit /b 1)',
  'node "%~dp0..\\launcher.js" %*',
  '',
].join('\r\n');

export const SHIM_SH = [
  '#!/bin/sh',
  '# Terminal-Design: atalho gerado pelo instalador. Nao edite.',
  'basedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")',
  'exec node "$basedir/../launcher.js" "$@"',
  '',
].join('\n');

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

/** (Re)write launcher.js, the bin shims and the marker. Returns the written paths. */
export function writeLauncherFiles(paths, opts) {
  writeFileAtomic(paths.launcher, fs.readFileSync(LAUNCHER_TEMPLATE));
  // launcher.js is CommonJS; pin that so a stray {"type":"module"} package.json in a
  // parent folder (e.g. the user's home) can never change how it loads.
  writeFileAtomic(path.join(paths.dataHome, 'package.json'), '{\n  "private": true,\n  "type": "commonjs"\n}\n');
  const cmd = path.join(paths.binDir, 'td.cmd');
  const sh = path.join(paths.binDir, 'td');
  writeFileAtomic(cmd, SHIM_CMD);
  writeFileAtomic(sh, SHIM_SH);
  writeMarker(paths, opts);
  return { launcher: paths.launcher, cmd, sh, marker: markerFile(paths) };
}

export function launcherFilesPresent(paths) {
  return fs.existsSync(paths.launcher) && fs.existsSync(path.join(paths.binDir, 'td.cmd')) && !!readMarker(paths);
}
