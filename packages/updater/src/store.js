// Installed versions under dataHome:
//   versions\<semver>\   full program copies
//   current.json         {"version": "x.y.z", "previous": "a.b.c" | null, "switchedAt": ISO}
// Config (configHome) is never read or written here.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJsonAtomic, compareSemver } from '../../core/src/index.js';

export const VERSION_DIR = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function isVersionName(v) {
  return typeof v === 'string' && VERSION_DIR.test(v);
}

export function versionDir(paths, v) {
  if (!isVersionName(v)) throw new Error(`versão inválida: ${v}`);
  return path.join(paths.versions, v);
}

/** current.json contents or null when missing / invalid. */
export function readCurrent(paths) {
  let cur;
  try { cur = readJson(paths.currentFile, null); } catch { return null; }
  if (!cur || !isVersionName(cur.version)) return null;
  return { version: cur.version, previous: isVersionName(cur.previous) ? cur.previous : null, switchedAt: cur.switchedAt ?? null };
}

export function writeCurrent(paths, cur) {
  writeJsonAtomic(paths.currentFile, {
    version: cur.version,
    previous: cur.previous ?? null,
    switchedAt: cur.switchedAt ?? new Date().toISOString(),
  });
}

/** A version folder is usable when it has bin/td.js and a package.json with the same version. */
export function isValidVersionDir(paths, v) {
  if (!isVersionName(v)) return false;
  const dir = path.join(paths.versions, v);
  if (!fs.existsSync(path.join(dir, 'bin', 'td.js'))) return false;
  try {
    return readJson(path.join(dir, 'package.json')).version === v;
  } catch {
    return false;
  }
}

/** Installed semver folders, newest first. */
export function listInstalledVersions(paths) {
  let names = [];
  try { names = fs.readdirSync(paths.versions); } catch { return []; }
  return names.filter(isVersionName).sort((a, b) => compareSemver(b, a));
}

function rm(p) {
  fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function stamp() {
  return `${Date.now().toString(36)}${process.pid.toString(36)}`;
}

/**
 * Put a new program copy at versions\<v>. `populate(dir)` fills a fresh folder on the same
 * volume; the swap is two renames, and the previous folder (if any) is kept until commit().
 * Returns { dir, replaced, commit(), revert() }.
 */
export function prepareVersionDir(paths, v, populate) {
  const target = versionDir(paths, v);
  fs.mkdirSync(paths.versions, { recursive: true });
  const incoming = path.join(paths.versions, `.${v}.incoming-${stamp()}`);
  const old = path.join(paths.versions, `.${v}.old-${stamp()}`);
  try {
    fs.mkdirSync(incoming);
    populate(incoming);
  } catch (err) {
    rm(incoming);
    throw err;
  }
  const replaced = fs.existsSync(target);
  if (replaced) fs.renameSync(target, old);
  try {
    fs.renameSync(incoming, target);
  } catch (err) {
    if (replaced) fs.renameSync(old, target);
    rm(incoming);
    throw err;
  }
  let done = false;
  return {
    dir: target,
    replaced,
    /** Never throws: a leftover .old folder is only clutter, and prune() cleans it up later. */
    commit() {
      if (done) return true;
      done = true;
      if (!replaced) return true;
      try { rm(old); return true; } catch { return false; }
    },
    revert() {
      if (done) return;
      done = true;
      rm(target);
      if (replaced) fs.renameSync(old, target);
    },
  };
}

/**
 * Make `v` the current version. `previous` defaults to the version that was current
 * (unless it is the same version, in which case the old `previous` is kept).
 * Returns { before, after }.
 */
export function activate(paths, v, { previous } = {}) {
  if (!isValidVersionDir(paths, v)) throw new Error(`a versão ${v} não está instalada corretamente`);
  const before = readCurrent(paths);
  let prev = previous;
  if (prev === undefined) prev = before && before.version !== v ? before.version : before?.previous ?? null;
  if (prev === v) prev = before?.previous && before.previous !== v ? before.previous : null;
  const after = { version: v, previous: prev ?? null, switchedAt: new Date().toISOString() };
  writeCurrent(paths, after);
  return { before, after };
}

/** Swap current and previous. Throws when there is nothing valid to go back to. */
export function rollback(paths) {
  const cur = readCurrent(paths);
  if (!cur) throw new Error(`current.json ausente ou inválido; reinstale com ${process.platform === 'win32' ? 'scripts\\install.ps1' : 'sh scripts/install.sh'}`);
  if (!cur.previous) throw new Error('não há versão anterior registrada para voltar');
  if (!isValidVersionDir(paths, cur.previous)) throw new Error(`a versão anterior ${cur.previous} não está mais instalada`);
  const after = { version: cur.previous, previous: cur.version, switchedAt: new Date().toISOString() };
  writeCurrent(paths, after);
  return { before: cur, after };
}

/**
 * Keep only current + previous (+ `extraKeep`). Also removes leftover temp folders.
 * Returns the removed version names.
 */
export function prune(paths, { extraKeep = [] } = {}) {
  const cur = readCurrent(paths);
  const keep = new Set([cur?.version, cur?.previous, ...extraKeep].filter(Boolean));
  if (!keep.size) return []; // without a valid current.json, never delete anything
  const removed = [];
  let names = [];
  try { names = fs.readdirSync(paths.versions); } catch { return []; }
  for (const name of names) {
    const full = path.join(paths.versions, name);
    if (isVersionName(name)) {
      if (keep.has(name)) continue;
      rm(full);
      removed.push(name);
    } else if (/^\.\d+\.\d+\.\d+.*\.(incoming|old)-[0-9a-z]+$/.test(name)) {
      // leftovers from an interrupted install, older than 1 hour
      try {
        if (Date.now() - fs.statSync(full).mtimeMs > 3600e3) rm(full);
      } catch { /* ignore */ }
    }
  }
  return removed;
}

/** Simple exclusive lock (staging\update.lock). Stale locks (> 30 min) are taken over. */
export function acquireLock(paths, name = 'update.lock') {
  fs.mkdirSync(paths.staging, { recursive: true });
  const file = path.join(paths.staging, name);
  const tryTake = () => {
    const fd = fs.openSync(file, 'wx');
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    fs.closeSync(fd);
  };
  try {
    tryTake();
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    let age = 0;
    try { age = Date.now() - fs.statSync(file).mtimeMs; } catch { /* vanished */ }
    if (age < 30 * 60e3) throw new Error('outra atualização/instalação do Terminal-Design está em andamento');
    fs.rmSync(file, { force: true });
    tryTake();
  }
  return () => fs.rmSync(file, { force: true });
}
