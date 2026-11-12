import fs from 'node:fs';
import path from 'node:path';

export function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(stripBom(fs.readFileSync(file, 'utf8')));
  } catch (err) {
    if (fallback !== undefined && (err.code === 'ENOENT' || err instanceof SyntaxError)) return fallback;
    throw err;
  }
}

/**
 * Strict read for files we are about to modify: missing file -> `missing`,
 * unreadable/invalid JSON or non-object -> throws. Never returns a silent default
 * for a broken file, so we can't overwrite a user's file with partial content.
 */
export function readJsonForUpdate(file, missing = {}) {
  if (!fs.existsSync(file)) return missing;
  let value;
  try {
    value = JSON.parse(stripBom(fs.readFileSync(file, 'utf8')));
  } catch (err) {
    throw new Error(`não consegui ler ${file}: ${err.message}. Corrija o arquivo antes; nada foi alterado.`);
  }
  if (!isPlainObject(value)) throw new Error(`${file} não contém um objeto JSON; nada foi alterado.`);
  return value;
}

/**
 * Parse JSON with comments and trailing commas (Windows Terminal / VS Code settings).
 * String contents are preserved; only comments outside strings are removed.
 */
export function parseJsonc(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') { out += n ?? ''; i++; } else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return JSON.parse(stripBom(out).replace(/,(\s*[}\]])/g, '$1'));
}

export function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Write via temp file + rename so a crash never leaves a half-written file. */
export function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function writeJsonAtomic(file, value) {
  writeFileAtomic(file, JSON.stringify(value, null, 2) + '\n');
}

/** Copy `file` into `backupDir` with a timestamped name. Returns the backup path or null. */
export function backupFile(file, backupDir, label = path.basename(file)) {
  if (!fs.existsSync(file)) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupDir, `${label}.${stamp}.bak`);
  fs.copyFileSync(file, dest);
  return dest;
}

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Deep merge: objects merge recursively, arrays and scalars from `over` replace. */
export function deepMerge(base, over) {
  if (!isPlainObject(base) || !isPlainObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/**
 * Environment for a Windows PowerShell 5.1 child process. When td runs inside PowerShell 7, the
 * inherited PSModulePath points at PowerShell 7 modules and 5.1 then fails to load its own
 * cmdlets. Without PSModulePath, Windows PowerShell rebuilds its default module path.
 */
export function windowsPowerShellEnv(env = process.env, extra = {}) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (k.toLowerCase() !== 'psmodulepath') out[k] = v;
  return { ...out, ...extra };
}
