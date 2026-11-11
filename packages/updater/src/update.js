// `td update` engine: find release -> download -> verify SHA-256 -> extract -> sanity +
// smoke test -> back up config -> install versions\<new> -> switch current.json -> prune.
// Any failure after the install step rolls back. Config in configHome is never written.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compareSemver, readJson, readPackage, backupFile } from '../../core/src/index.js';
import { fetchReleases, selectRelease, findAssets, summarizeNotes, resolveRepo, httpsGet, UpdateError } from './github.js';
import { verifyChecksum } from './checksum.js';
import { extractZip } from './zip.js';
import { prepareVersionDir, activate, writeCurrent, readCurrent, prune, isValidVersionDir, acquireLock, rollback } from './store.js';
import { writeLauncherFiles, launcherFilesPresent } from './launcher.js';
import { cacheFile } from './notice.js';

/** Find the folder inside an extracted release that holds package.json (root or single subfolder). */
export function findPackageRoot(dir) {
  if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
  const subs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  if (subs.length === 1 && fs.existsSync(path.join(dir, subs[0].name, 'package.json'))) return path.join(dir, subs[0].name);
  throw new Error('o pacote baixado não contém package.json na raiz');
}

/** Run the downloaded td once (`td version`) with a timeout. Only called after checksum verification. */
export function smokeTest(root, version, { paths, timeoutMs = 30000 } = {}) {
  const r = spawnSync(process.execPath, [path.join(root, 'bin', 'td.js'), 'version'], {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    env: { ...process.env, TD_DATA_HOME: paths.dataHome, TD_CONFIG_HOME: paths.configHome, TD_NO_UPDATE_CHECK: '1', NO_COLOR: '1' },
  });
  if (r.error) throw new Error(`teste da nova versão falhou: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`teste da nova versão falhou (código ${r.status}): ${(r.stderr || r.stdout || '').trim().split(/\r?\n/)[0]}`);
  if (!String(r.stdout).includes(version)) throw new Error(`teste da nova versão não mostrou a versão ${version}`);
}

/** Validate an extracted release before it goes anywhere near versions\. */
export function sanityCheck(root, version) {
  let pkg;
  try { pkg = readJson(path.join(root, 'package.json')); } catch { throw new Error('package.json do pacote é inválido'); }
  if (pkg.version !== version) throw new Error(`versão do pacote (${pkg.version}) não confere com a release (${version})`);
  if (!fs.existsSync(path.join(root, 'bin', 'td.js'))) throw new Error('o pacote não contém bin/td.js');
}

async function download(fetch, url, label) {
  if (!url || !/^https:\/\//i.test(url)) throw new UpdateError('network', `URL de download inválida para ${label}`);
  const res = await fetch(url, { headers: { Accept: 'application/octet-stream' }, timeoutMs: 120000, maxBytes: 200 * 1024 * 1024 });
  if (res.status !== 200) throw new UpdateError('http', `download de ${label} falhou (HTTP ${res.status})`);
  return Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
}

/** Network part: which release is available for this channel. */
export async function findUpdate({ config, pkg, fetch = httpsGet, env = process.env, channel }) {
  const repo = resolveRepo(config, pkg);
  const ch = channel || config?.update?.channel || 'stable';
  const best = selectRelease(await fetchReleases(repo, { fetch, env }), ch);
  return { repo, channel: ch, best };
}

/**
 * Download, verify and install `best` ({release, version}). Returns {version, previous, pruned}.
 * Throws (after rolling back) on any problem.
 */
export async function applyUpdate({ paths, best, pkg, currentVersion, fetch = httpsGet, smoke = smokeTest, log = () => {}, useTar = true, pruneFn = prune }) {
  const { version, release } = best;
  const assets = findAssets(release, version, pkg?.terminalDesign);
  if (!assets.zip) throw new UpdateError('asset', `a release ${version} não tem o arquivo ${assets.zipName}`);
  if (!assets.sums) throw new UpdateError('asset', `a release ${version} não tem ${assets.sumName}; sem checksum a atualização é recusada`);

  const release_ = acquireLock(paths);
  const work = path.join(paths.staging, `update-${version}-${Date.now().toString(36)}`);
  let handle = null;
  let before = null;
  let switched = false;
  try {
    fs.mkdirSync(work, { recursive: true });
    log(`baixando ${assets.zipName}…`);
    const zipBuf = await download(fetch, assets.zip.browser_download_url, assets.zipName);
    const sumsBuf = await download(fetch, assets.sums.browser_download_url, assets.sumName);
    const hash = verifyChecksum(zipBuf, assets.zipName, sumsBuf.toString('utf8'));
    log(`SHA-256 conferido (${hash.slice(0, 16)}…)`);

    const zipFile = path.join(work, assets.zipName);
    fs.writeFileSync(zipFile, zipBuf);
    const extractDir = path.join(work, 'extract');
    extractZip(zipFile, extractDir, { useTar });
    const root = findPackageRoot(extractDir);
    sanityCheck(root, version);
    smoke(root, version, { paths });
    log('nova versão testada');

    const bak = backupFile(paths.configFile, paths.backups, 'config.json');
    if (bak) log(`backup da configuração: ${bak}`);

    handle = prepareVersionDir(paths, version, (dir) => {
      // same volume (both under dataHome): move the extracted files instead of copying
      fs.rmdirSync(dir);
      fs.renameSync(root, dir);
    });
    before = readCurrent(paths);
    activate(paths, version, { previous: currentVersion !== version ? currentVersion : before?.previous });
    switched = true;
    if (!isValidVersionDir(paths, version)) throw new Error('a nova versão não ficou íntegra após a instalação');
    if (!launcherFilesPresent(paths)) writeLauncherFiles(paths);
    handle.commit(); // never throws
  } catch (err) {
    const notes = [];
    try {
      if (switched) {
        writeCurrent(paths, before ?? { version: currentVersion, previous: null });
        notes.push('current.json restaurado');
      }
      if (handle) { handle.revert(); notes.push('arquivos da nova versão removidos'); }
    } catch (e) {
      notes.push(`ATENÇÃO: falha ao desfazer (${e.message})`);
    }
    if (notes.length) err.message += ` (desfeito: ${notes.join(', ')})`;
    throw err;
  } finally {
    // cleanup is best effort: a locked temp file must not turn a finished update into a failure
    try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { log(`aviso: não foi possível limpar ${work} (${e.code || e.message})`); }
    try { release_(); } catch { /* stale lock is taken over after 30 min */ }
  }

  // The new version is live from here on. Pruning is best effort and never rolls back.
  let pruned = [];
  const warnings = [];
  try {
    pruned = pruneFn(paths);
  } catch (e) {
    warnings.push(`não foi possível remover versões antigas (${e.code || e.message})`);
  }
  return { version, previous: currentVersion, pruned, warnings };
}

/** Full `td update` flow with output. Returns an exit code. */
export async function runUpdate({ ctx, flags = {}, fetch = httpsGet, env = process.env, smoke = smokeTest, pkg = readPackage(), useTar = true }) {
  const { ui, paths, config } = ctx;
  const currentVersion = ctx.version;

  if (flags.rollback) return runRollback({ ctx, flags });

  const channel = flags.prerelease ? 'prerelease' : flags.channel === 'prerelease' || flags.channel === 'stable' ? flags.channel : undefined;
  ui.title('Terminal-Design · atualização');
  let found;
  try {
    found = await findUpdate({ config, pkg, fetch, env, channel });
  } catch (err) {
    ui.warn(`não foi possível verificar atualizações: ${err.message}`);
    writeNoticeCache(paths, { repo: safeRepo(config, pkg), channel: channel || config?.update?.channel || 'stable', best: null }, err);
    return err.code === 'not-found' ? 0 : 1;
  }
  // keep the notice cache in sync with what we just learned
  writeNoticeCache(paths, found);

  const { best } = found;
  ui.table([
    ['instalada', currentVersion],
    ['disponível', best ? best.version : 'nenhuma release publicada'],
    ['canal', found.channel],
    ['modo', ctx.mode === 'managed' ? 'instalado (managed)' : 'clone git (dev)'],
  ]);
  if (!best) return 0;
  if (compareSemver(best.version, currentVersion) <= 0) {
    ui.ok('você já está na versão mais recente.');
    return 0;
  }
  const notes = summarizeNotes(best.release.body);
  if (notes.length) {
    ui.print(`\n  ${ui.c.bold(`Novidades da ${best.version}`)}`);
    for (const l of notes) ui.print(`  ${ui.c.muted('│')} ${l}`);
  }
  if (best.release.html_url) ui.print(`  ${ui.c.muted(best.release.html_url)}`);
  ui.print('');

  if (ctx.mode !== 'managed') {
    ui.info('Você está rodando de um clone git (modo dev). Para atualizar, use:');
    ui.print(`    ${ui.c.accent('git pull')}`);
    return 0;
  }
  if (flags.check) {
    ui.info(`rode ${ui.c.accent('td update')} para instalar.`);
    return 0;
  }
  if (!flags.yes && !(await ui.confirm(`Atualizar de ${currentVersion} para ${best.version}?`, false))) {
    ui.info('atualização cancelada.');
    return 0;
  }
  try {
    const r = await applyUpdate({ paths, best, pkg, currentVersion, fetch, smoke, useTar, log: (s) => ui.info(s) });
    ui.ok(`Terminal-Design atualizado para ${r.version}. A versão ${r.previous} ficou guardada (td update --rollback).`);
    if (r.pruned.length) ui.info(`versões antigas removidas: ${r.pruned.join(', ')}`);
    for (const w of r.warnings ?? []) ui.warn(w);
    ui.info('sua configuração não foi alterada.');
    return 0;
  } catch (err) {
    ui.error(`atualização falhou: ${err.message}`);
    ui.info(`você continua na versão ${currentVersion}.`);
    return 1;
  }
}

function safeRepo(config, pkg) {
  try { return resolveRepo(config, pkg); } catch { return null; }
}

function writeNoticeCache(paths, found, err = null) {
  try {
    const now = Date.now();
    let latest = found.best ? { version: found.best.version, url: found.best.release.html_url ?? null, prerelease: !!found.best.release.prerelease } : null;
    // A passing network problem keeps what we already knew; any real answer replaces it.
    if (err && err.code === 'network') {
      try { latest = JSON.parse(fs.readFileSync(cacheFile(paths), 'utf8')).latest ?? null; } catch { latest = null; }
    }
    const error = err ? { code: err.code ?? 'error', message: err.message } : null;
    fs.mkdirSync(paths.cache, { recursive: true });
    fs.writeFileSync(cacheFile(paths), JSON.stringify({ checkedAt: now, lastAttemptAt: now, channel: found.channel, repo: found.repo, latest, error }, null, 2));
  } catch { /* best effort */ }
}

export async function runRollback({ ctx, flags = {} }) {
  const { ui, paths } = ctx;
  if (ctx.mode !== 'managed') {
    ui.warn('rollback só existe em instalações feitas pelo instalador (modo managed). No clone git, use git checkout.');
    return 1;
  }
  const cur = readCurrent(paths);
  if (!cur?.previous) {
    ui.warn('não há versão anterior registrada.');
    return 1;
  }
  if (!flags.yes && !(await ui.confirm(`Voltar da versão ${cur.version} para ${cur.previous}?`, false))) {
    ui.info('cancelado.');
    return 0;
  }
  const r = rollback(paths);
  ui.ok(`agora usando a versão ${r.after.version} (a ${r.after.previous} continua instalada).`);
  return 0;
}
