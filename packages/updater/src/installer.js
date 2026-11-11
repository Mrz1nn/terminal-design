// Local installer used by scripts/install.ps1. Copies the program files of a cloned or
// downloaded repo into %LOCALAPPDATA%\TerminalDesign\versions\<version>, writes the
// launcher + shims + current.json, creates the config only if missing, adds bin\ to the
// user PATH. Safe to run again (same version is replaced in place, config untouched).
//
//   node packages/updater/src/installer.js [--no-path] [--theme=<name>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPaths, appRoot, readPackage } from '../../core/src/index.js';
import { ensureConfig, setConfigValue } from '../../config/src/index.js';
import { copyProgramFiles } from './files.js';
import { prepareVersionDir, activate, prune, isVersionName, acquireLock } from './store.js';
import { writeLauncherFiles } from './launcher.js';
import { addUserPath } from './pathenv.js';

export function themeExists(name, paths, sourceRoot) {
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return false;
  return [path.join(sourceRoot, 'themes'), paths.userThemes].some((d) => fs.existsSync(path.join(d, `${name}.json`)));
}

/** Returns a summary object. Throws on failure (nothing is half-switched). */
export function installLocal({ sourceRoot = appRoot, paths = getPaths(), addPath = true, theme = null, log = () => {} } = {}) {
  const pkg = readPackage(sourceRoot);
  const version = pkg.version;
  if (!isVersionName(version)) throw new Error(`versão inválida em package.json: ${version}`);

  const unlock = acquireLock(paths, 'install.lock');
  let summary;
  try {
    let count = 0;
    let switched;
    const handle = prepareVersionDir(paths, version, (dir) => { count = copyProgramFiles(sourceRoot, dir); });
    try {
      writeLauncherFiles(paths);
      switched = activate(paths, version);
      handle.commit();
    } catch (err) {
      handle.revert();
      throw err;
    }
    log(`${count} arquivos copiados para ${handle.dir}`);
    summary = { version, before: switched.before, after: switched.after, files: count, dir: handle.dir, reinstall: handle.replaced };
  } finally {
    unlock();
  }

  summary.configCreated = ensureConfig(paths);
  log(summary.configCreated ? `configuração criada em ${paths.configFile}` : `configuração existente mantida: ${paths.configFile}`);
  if (theme) {
    if (themeExists(theme, paths, sourceRoot)) {
      setConfigValue('theme.name', theme, paths);
      summary.theme = theme;
      log(`tema definido: ${theme}`);
    } else {
      summary.themeError = `tema "${theme}" não encontrado; o tema atual foi mantido`;
      log(summary.themeError);
    }
  }

  summary.path = 'skipped';
  if (addPath) {
    const r = addUserPath(paths.binDir);
    summary.path = r.result;
    if (!r.ok) log(`não foi possível alterar o PATH (${r.detail || r.result}); adicione manualmente: ${paths.binDir}`);
  }
  summary.pruned = prune(paths);
  return summary;
}

function parseCli(argv) {
  const o = { addPath: true, theme: null };
  for (const a of argv) {
    if (a === '--no-path') o.addPath = false;
    else if (a.startsWith('--theme=')) o.theme = a.slice(8) || null;
  }
  return o;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseCli(process.argv.slice(2));
  const paths = getPaths();
  try {
    const s = installLocal({ ...opts, paths, log: (m) => console.log(`  › ${m}`) });
    const what = s.reinstall ? 'reinstalado' : s.before?.version ? `atualizado de ${s.before.version}` : 'instalado';
    console.log(`✓ Terminal-Design ${s.version} ${what}.`);
    console.log(`  programa:      ${s.dir}`);
    console.log(`  configuração:  ${paths.configFile}`);
    console.log(`  atalho:        ${path.join(paths.binDir, 'td.cmd')}`);
    if (s.path === 'changed') console.log('  PATH:          bin adicionado ao PATH do usuário (abra um terminal novo)');
    else if (s.path === 'unchanged') console.log('  PATH:          já estava configurado');
    else if (s.path === 'skipped') console.log(`  PATH:          não alterado (-NoPath). Use: "${path.join(paths.binDir, 'td.cmd')}"`);
    if (s.pruned.length) console.log(`  versões antigas removidas: ${s.pruned.join(', ')}`);
  } catch (err) {
    console.error(`✗ instalação falhou: ${err.message}`);
    if (process.env.TD_DEBUG) console.error(err);
    process.exitCode = 1;
  }
}
