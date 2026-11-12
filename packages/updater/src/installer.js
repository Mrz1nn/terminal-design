// Local installer used by scripts/install.ps1 and scripts/install.sh. Copies the program files of a cloned or
// downloaded repo into %LOCALAPPDATA%\TerminalDesign\versions\<version>, writes the
// launcher + shims + current.json, creates the config only if missing, adds bin\ to the
// user PATH (Windows registry, or a marked block in ~/.zshrc etc. on macOS/Linux).
// Safe to run again (same version is replaced in place, config untouched).
//
//   node packages/updater/src/installer.js [--no-path] [--theme=<name>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPaths, appRoot, readPackage } from '../../core/src/index.js';
import { ensureConfig, setConfigValue } from '../../config/src/index.js';
import { copyProgramFiles } from './files.js';
import { prepareVersionDir, activate, prune, isVersionName, acquireLock } from './store.js';
import { writeLauncherFiles, shimPath } from './launcher.js';
import { addUserPath } from './pathenv.js';

export function themeExists(name, paths, sourceRoot) {
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return false;
  return [path.join(sourceRoot, 'themes'), paths.userThemes].some((d) => fs.existsSync(path.join(d, `${name}.json`)));
}

/**
 * Returns a summary object. Throws only when the new version could not be activated (then
 * nothing changed). Steps after activation are best effort and only add summary.warnings.
 * `deps` lets tests replace ensureConfig / addUserPath / prune.
 */
export function installLocal({ sourceRoot = appRoot, paths = getPaths(), addPath = true, theme = null, log = () => {}, deps = {}, platform = process.platform, home } = {}) {
  const d = { ensureConfig, setConfigValue, addUserPath, prune, ...deps };
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
      writeLauncherFiles(paths, { platform });
      switched = activate(paths, version);
    } catch (err) {
      handle.revert();
      throw err;
    }
    handle.commit(); // never throws
    log(`${count} arquivos copiados para ${handle.dir}`);
    summary = { version, before: switched.before, after: switched.after, files: count, dir: handle.dir, reinstall: handle.replaced };
  } finally {
    try { unlock(); } catch { /* stale lock is taken over later */ }
  }

  // The new version is live from here on: problems below are warnings, never a rollback.
  summary.warnings = [];
  const warn = (m) => { summary.warnings.push(m); log(`aviso: ${m}`); };

  summary.configCreated = false;
  try {
    summary.configCreated = d.ensureConfig(paths);
    log(summary.configCreated ? `configuração criada em ${paths.configFile}` : `configuração existente mantida: ${paths.configFile}`);
  } catch (e) {
    warn(`não foi possível criar a configuração (${e.code || e.message}); os padrões serão usados`);
  }
  if (theme) {
    if (themeExists(theme, paths, sourceRoot)) {
      try {
        d.setConfigValue('theme.name', theme, paths);
        summary.theme = theme;
        log(`tema definido: ${theme}`);
      } catch (e) {
        summary.themeError = `não foi possível definir o tema (${e.message})`;
        warn(summary.themeError);
      }
    } else {
      summary.themeError = `tema "${theme}" não encontrado; o tema atual foi mantido`;
      log(summary.themeError);
    }
  }

  summary.path = 'skipped';
  if (addPath) {
    try {
      const r = d.addUserPath(paths.binDir, { platform, home, backupDir: paths.backups });
      summary.path = r.result;
      summary.pathFiles = r.files ?? [];
      if (!r.ok) warn(`não foi possível alterar o PATH (${r.detail || r.result}); adicione manualmente: ${paths.binDir}`);
    } catch (e) {
      summary.path = 'error';
      warn(`não foi possível alterar o PATH (${e.message}); adicione manualmente: ${paths.binDir}`);
    }
  }

  summary.pruned = [];
  try {
    summary.pruned = d.prune(paths);
  } catch (e) {
    warn(`não foi possível remover versões antigas (${e.code || e.message})`);
  }
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

/** True when this file is the script node was started with. Compares real paths: on macOS the
 *  temp folder /var is a link to /private/var, and import.meta.url always holds the real path. */
export function isMainModule(argv1 = process.argv[1], selfUrl = import.meta.url) {
  if (!argv1) return false;
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  return real(argv1) === real(fileURLToPath(selfUrl));
}

if (isMainModule()) {
  const opts = parseCli(process.argv.slice(2));
  const paths = getPaths();
  try {
    const s = installLocal({ ...opts, paths, log: (m) => console.log(`  › ${m}`) });
    const what = s.reinstall ? 'reinstalado' : s.before?.version ? `atualizado de ${s.before.version}` : 'instalado';
    console.log(`✓ Terminal-Design ${s.version} ${what}.`);
    console.log(`  programa:      ${s.dir}`);
    console.log(`  configuração:  ${paths.configFile}`);
    console.log(`  atalho:        ${shimPath(paths)}`);
    if (s.path === 'changed') console.log(`  PATH:          bin adicionado${s.pathFiles?.length ? ` em ${s.pathFiles.join(', ')}` : ' ao PATH do usuário'} (abra um terminal novo)`);
    else if (s.path === 'unchanged') console.log('  PATH:          já estava configurado');
    else if (s.path === 'skipped') console.log(`  PATH:          não alterado (${process.platform === 'win32' ? '-NoPath' : '--no-path'}). Use: "${shimPath(paths)}"`);
    if (s.pruned.length) console.log(`  versões antigas removidas: ${s.pruned.join(', ')}`);
    if (s.warnings.length) console.log(`! instalado com ${s.warnings.length} aviso(s) (veja acima).`);
  } catch (err) {
    // Only reached when activation failed, so the previous install (if any) is untouched.
    console.error(`✗ instalação falhou: ${err.message}`);
    if (process.env.TD_DEBUG) console.error(err);
    process.exitCode = 1;
  }
}
