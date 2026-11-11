// Cheap "new version available" notice for the dashboard / cockpit.
//
// getUpdateNotice() never touches the network: it reads cache\update-check.json. When the
// cache is older than update.checkIntervalHours it starts a detached background check
// (at most once every 10 minutes) and returns whatever the old cache says. Nothing is
// ever installed automatically.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, writeJsonAtomic, compareSemver, readPackage, parseSemver, getPaths, installMode, currentVersion as runningVersion } from '../../core/src/index.js';
import { fetchReleases, selectRelease, resolveRepo } from './github.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ATTEMPT_BACKOFF_MS = 10 * 60e3;

export function cacheFile(paths) {
  return path.join(paths.cache, 'update-check.json');
}

export function readUpdateCache(paths) {
  try {
    const c = readJson(cacheFile(paths), null);
    return c && typeof c === 'object' ? c : null;
  } catch {
    return null;
  }
}

function writeCache(paths, data) {
  try { writeJsonAtomic(cacheFile(paths), data); } catch { /* cache is best effort */ }
}

function intervalMs(config) {
  const h = Number(config?.update?.checkIntervalHours);
  return (Number.isFinite(h) && h > 0 ? h : 24) * 3600e3;
}

function channelOf(config) {
  return config?.update?.channel === 'prerelease' ? 'prerelease' : 'stable';
}

/** Network check; writes the cache. Returns {latest: {version, url, prerelease} | null, error}. */
export async function checkForUpdates({ paths, config, fetch, env = process.env, now = Date.now(), pkg = readPackage() } = {}) {
  const channel = channelOf(config);
  let repo = null;
  const entry = { checkedAt: now, lastAttemptAt: now, channel, repo: null, latest: null, error: null };
  try {
    repo = resolveRepo(config, pkg);
    entry.repo = repo;
    const best = selectRelease(await fetchReleases(repo, { fetch, env }), channel);
    if (best) entry.latest = { version: best.version, url: best.release.html_url ?? null, prerelease: !!best.release.prerelease };
  } catch (err) {
    entry.error = { code: err.code ?? 'error', message: err.message };
    // a passing network problem keeps what we already knew
    if (err.code === 'network') entry.latest = readUpdateCache(paths)?.latest ?? null;
  }
  writeCache(paths, entry);
  return entry;
}

function isFresh(cache, config, repo, now) {
  return !!cache && Number.isFinite(cache.checkedAt) && now - cache.checkedAt < intervalMs(config)
    && cache.channel === channelOf(config) && cache.repo === repo;
}

/** Start the background refresh, detached and hidden. Never throws. */
export function spawnBackgroundCheck(paths, { now = Date.now() } = {}) {
  try {
    const cache = readUpdateCache(paths) ?? {};
    if (Number.isFinite(cache.lastAttemptAt) && now - cache.lastAttemptAt < ATTEMPT_BACKOFF_MS) return false;
    writeCache(paths, { ...cache, lastAttemptAt: now });
    const child = spawn(process.execPath, [path.join(here, 'check-worker.js')], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, TD_DATA_HOME: paths.dataHome, TD_CONFIG_HOME: paths.configHome },
    });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Short pt-BR notice or null. No network, ever; at most it starts a background refresh.
 * Every option is optional (`offline` is accepted for clarity: this function is always offline).
 * background=false also skips starting the detached refresh (tests).
 */
export function getUpdateNotice({ paths = getPaths(), config, currentVersion, mode, now = Date.now(), background = true, env = process.env, pkg } = {}) {
  try {
    if (!currentVersion) currentVersion = runningVersion();
    if (!mode) mode = installMode(paths);
    if (config?.update?.auto === 'off' || env.TD_NO_UPDATE_CHECK) return null;
    let repo;
    try { repo = resolveRepo(config, pkg ?? readPackage()); } catch { return null; }
    const cache = readUpdateCache(paths);
    if (!isFresh(cache, config, repo, now) && background) spawnBackgroundCheck(paths, { now });
    const latest = cache?.repo === repo && cache?.channel === channelOf(config) ? cache?.latest?.version : null;
    if (!latest || !parseSemver(latest) || !parseSemver(currentVersion)) return null;
    if (compareSemver(latest, currentVersion) <= 0) return null;
    return mode === 'dev'
      ? `Terminal-Design ${latest} disponível (git pull)`
      : `Terminal-Design ${latest} disponível: rode td update`;
  } catch {
    return null;
  }
}
