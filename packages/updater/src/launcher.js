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

/** (Re)write launcher.js and the bin shims. Returns the written paths. */
export function writeLauncherFiles(paths) {
  writeFileAtomic(paths.launcher, fs.readFileSync(LAUNCHER_TEMPLATE));
  // launcher.js is CommonJS; pin that so a stray {"type":"module"} package.json in a
  // parent folder (e.g. the user's home) can never change how it loads.
  writeFileAtomic(path.join(paths.dataHome, 'package.json'), '{\n  "private": true,\n  "type": "commonjs"\n}\n');
  const cmd = path.join(paths.binDir, 'td.cmd');
  const sh = path.join(paths.binDir, 'td');
  writeFileAtomic(cmd, SHIM_CMD);
  writeFileAtomic(sh, SHIM_SH);
  return { launcher: paths.launcher, cmd, sh };
}

export function launcherFilesPresent(paths) {
  return fs.existsSync(paths.launcher) && fs.existsSync(path.join(paths.binDir, 'td.cmd'));
}
