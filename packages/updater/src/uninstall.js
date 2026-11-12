// Removes a managed install. Only deletes names Terminal-Design itself creates inside
// dataHome / configHome; never deletes those folders unless they end up empty.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readMarker, LAUNCHER_HEADER, MARKER_NAME } from './launcher.js';
import { readCurrent } from './store.js';

/** Program files and caches inside dataHome. ('voice' is the folder left by versions up to 0.2.2.) */
export const DATA_ITEMS = ['versions', 'bin', 'launcher.js', 'package.json', 'current.json', 'staging', 'cache', 'logs', 'voice', 'claude-code-previous.json', 'node', MARKER_NAME];
/** Extra dataHome items removed only when the config is purged too (they hold config copies). */
export const DATA_PURGE_ITEMS = ['backups'];
/** Items inside configHome. */
export const CONFIG_ITEMS = ['config.json', 'themes'];

const win = process.platform === 'win32';

/** Normalized folder path for comparisons (case-insensitive on Windows). */
export function normDir(dir) {
  let d = path.resolve(String(dir));
  if (d.length > path.parse(d).root.length) d = d.replace(/[\\/]+$/, '');
  return win ? d.toLowerCase() : d;
}

export function sameDir(a, b) {
  return !!a && !!b && normDir(a) === normDir(b);
}

function isDangerous(dir) {
  const d = normDir(dir);
  return d === normDir(path.parse(path.resolve(dir)).root) || d === normDir(os.homedir()) || d.length < 6;
}

function defaultHome(winVar, parts, env) {
  return win && env[winVar] ? path.join(env[winVar], 'TerminalDesign') : path.join(os.homedir(), ...parts);
}

/**
 * Is dataHome really a Terminal-Design folder? True when it has our marker file, or our
 * launcher + a valid current.json (installs made before the marker existed), or it is the
 * default location (%LOCALAPPDATA%\TerminalDesign).
 */
export function ownsDataHome(paths, env = process.env) {
  if (readMarker(paths)) return true;
  try {
    if (fs.readFileSync(paths.launcher, 'utf8').startsWith(LAUNCHER_HEADER) && readCurrent(paths)) return true;
  } catch { /* no launcher */ }
  return sameDir(paths.dataHome, defaultHome('LOCALAPPDATA', ['.local', 'share', 'terminal-design'], env));
}

/** configHome is ours when it is the default location or the custom one recorded by the installer. */
export function ownsConfigHome(paths, marker = readMarker(paths), env = process.env) {
  if (sameDir(paths.configHome, defaultHome('APPDATA', ['.config', 'terminal-design'], env))) return true;
  return !!marker?.configHome && sameDir(marker.configHome, paths.configHome);
}

function removeItems(base, names, removed, kept) {
  for (const name of names) {
    const p = path.join(base, name);
    if (!fs.existsSync(p)) continue;
    try {
      fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      removed.push(p);
    } catch (err) {
      kept.push(`${p} (${err.code || err.message})`);
    }
  }
  try {
    if (fs.existsSync(base) && fs.readdirSync(base).length === 0) { fs.rmdirSync(base); removed.push(base); }
  } catch { /* leave it */ }
}

/** Items that may be in use by the running td on Windows (td.cmd, the private node.exe). */
const IN_USE_ITEMS = ['bin', 'node'];

/**
 * Delete `dirs` (and dataHome if it ends up empty) a moment after this process exits.
 * Needed on Windows because cmd.exe re-reads td.cmd after node returns, and the private
 * node.exe that runs us is locked while it runs. Detached + hidden.
 * Windows uses cmd.exe (not node, which could be the very node.exe being deleted).
 */
export function scheduleDeferredRemoval(dirs, dataHome) {
  const list = (Array.isArray(dirs) ? dirs : [dirs]).filter(Boolean);
  let child;
  if (process.platform === 'win32') {
    // Windows paths cannot contain '"', so plain quoting is safe here.
    const rms = list.map((d) => `rmdir /s /q "${d}"`).join(' & ');
    const script = `ping -n 4 127.0.0.1 >nul & ${rms} & ping -n 2 127.0.0.1 >nul & ${rms} & rmdir "${dataHome}" 2>nul`;
    child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', script], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true });
  } else {
    const code = "const fs=require('fs');const a=process.argv.slice(1);const d=a.pop();setTimeout(()=>{for(const b of a){try{fs.rmSync(b,{recursive:true,force:true,maxRetries:10,retryDelay:300})}catch{}}try{if(!fs.readdirSync(d).length)fs.rmdirSync(d)}catch{}},2500)";
    child = spawn(process.execPath, ['-e', code, ...list, dataHome], { detached: true, stdio: 'ignore', windowsHide: true });
  }
  child.on('error', () => {});
  child.unref();
}

/** Returns {removed: string[], kept: string[], deferred: string[]}. deferBin: see scheduleDeferredRemoval. */
export function removeInstall(paths, { keepConfig = true, deferBin = false, env = process.env } = {}) {
  const removed = [];
  const kept = [];
  if (isDangerous(paths.dataHome) || isDangerous(paths.configHome)) throw new Error('pasta de dados/configuração suspeita; nada foi removido');
  const marker = readMarker(paths); // read before anything is deleted
  const configOwned = ownsConfigHome(paths, marker, env);
  if (fs.existsSync(paths.dataHome) && !ownsDataHome(paths, env)) {
    throw new Error(`${paths.dataHome} não parece ser uma instalação do Terminal-Design (sem o arquivo ${MARKER_NAME}); nada foi removido`);
  }
  // bin\td.cmd may be the script running right now: delete it last
  // When backups stay behind, the marker stays too, so a later `td uninstall --purge` can
  // still prove the folder is ours.
  const keepMarker = keepConfig && fs.existsSync(path.join(paths.dataHome, 'backups'));
  const order = DATA_ITEMS.filter((n) => !IN_USE_ITEMS.includes(n) && !(keepMarker && n === MARKER_NAME))
    .concat(keepConfig ? [] : DATA_PURGE_ITEMS, deferBin ? [] : IN_USE_ITEMS);
  removeItems(paths.dataHome, order, removed, kept);
  const deferred = [];
  if (deferBin) {
    const dirs = IN_USE_ITEMS.map((n) => path.join(paths.dataHome, n)).filter((d) => fs.existsSync(d));
    if (dirs.length) {
      scheduleDeferredRemoval(dirs, paths.dataHome);
      deferred.push(...dirs);
    }
  }
  if (!keepConfig && !configOwned) kept.push(`${paths.configHome} (pasta de configuração personalizada não registrada pelo instalador; apague manualmente se quiser)`);
  else if (!keepConfig) removeItems(paths.configHome, CONFIG_ITEMS, removed, kept);
  else if (fs.existsSync(paths.configHome)) kept.push(paths.configHome);
  if (keepConfig && fs.existsSync(path.join(paths.dataHome, 'backups'))) kept.push(path.join(paths.dataHome, 'backups'));
  return { removed, kept, deferred };
}
