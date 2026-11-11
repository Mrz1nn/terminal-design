// Removes a managed install. Only deletes names Terminal-Design itself creates inside
// dataHome / configHome; never deletes those folders unless they end up empty.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** Program files and caches inside dataHome. */
export const DATA_ITEMS = ['versions', 'bin', 'launcher.js', 'package.json', 'current.json', 'staging', 'cache', 'logs', 'voice', 'claude-code-previous.json'];
/** Extra dataHome items removed only when the config is purged too (they hold config copies). */
export const DATA_PURGE_ITEMS = ['backups'];
/** Items inside configHome. */
export const CONFIG_ITEMS = ['config.json', 'themes'];

function isDangerous(dir) {
  const d = path.resolve(dir);
  return d === path.parse(d).root || d === path.resolve(os.homedir()) || d.length < 6;
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

/**
 * Delete bin (and dataHome if it ends up empty) a moment after this process exits.
 * Needed because cmd.exe re-reads td.cmd after node returns; deleting it now would print
 * "batch file not found". Detached + hidden; paths go through argv, no shell.
 */
export function scheduleDeferredRemoval(binDir, dataHome) {
  const code = "const fs=require('fs');const [b,d]=process.argv.slice(1);setTimeout(()=>{try{fs.rmSync(b,{recursive:true,force:true,maxRetries:10,retryDelay:300})}catch{}try{if(!fs.readdirSync(d).length)fs.rmdirSync(d)}catch{}},2500)";
  const child = spawn(process.execPath, ['-e', code, binDir, dataHome], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

/** Returns {removed: string[], kept: string[], deferred: string[]}. deferBin: see scheduleDeferredRemoval. */
export function removeInstall(paths, { keepConfig = true, deferBin = false } = {}) {
  const removed = [];
  const kept = [];
  if (isDangerous(paths.dataHome) || isDangerous(paths.configHome)) throw new Error('pasta de dados/configuração suspeita; nada foi removido');
  // bin\td.cmd may be the script running right now: delete it last
  const order = DATA_ITEMS.filter((n) => n !== 'bin').concat(keepConfig ? [] : DATA_PURGE_ITEMS, deferBin ? [] : ['bin']);
  removeItems(paths.dataHome, order, removed, kept);
  const deferred = [];
  if (deferBin && fs.existsSync(paths.binDir)) {
    scheduleDeferredRemoval(paths.binDir, paths.dataHome);
    deferred.push(paths.binDir);
  }
  if (!keepConfig) removeItems(paths.configHome, CONFIG_ITEMS, removed, kept);
  else if (fs.existsSync(paths.configHome)) kept.push(paths.configHome);
  if (keepConfig && fs.existsSync(path.join(paths.dataHome, 'backups'))) kept.push(path.join(paths.dataHome, 'backups'));
  return { removed, kept, deferred };
}
