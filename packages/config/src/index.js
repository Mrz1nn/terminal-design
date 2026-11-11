import fs from 'node:fs';
import { getPaths, readJson, readJsonForUpdate, writeJsonAtomic, deepMerge, isPlainObject, backupFile } from '../../core/src/index.js';
import { DEFAULTS } from './defaults.js';

export { DEFAULTS };

const ENUMS = {
  'color.mode': ['auto', 'truecolor', '256', '16', 'none'],
  'cockpit.layout': ['compact', 'cockpit', 'full', 'custom'],
  'cockpit.locale': ['pt-BR', 'en'],
  'update.auto': ['off', 'notify'],
  'update.channel': ['stable', 'prerelease'],
  'voice.mode': ['push-to-talk', 'toggle'],
  'voice.language': ['pt', 'en', 'auto'],
  'voice.model': ['tiny', 'base', 'small', 'medium'],
  'voice.insertMode': ['type', 'paste'],
};

export function getAt(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setAt(obj, dotted, value) {
  const keys = dotted.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (!isPlainObject(o[k])) o[k] = {};
    o = o[k];
  }
  o[keys.at(-1)] = value;
  return obj;
}

/** Returns a list of human-readable problems. Empty list = valid. */
export function validate(cfg) {
  const errors = [];
  for (const [key, allowed] of Object.entries(ENUMS)) {
    const v = getAt(cfg, key);
    if (v !== undefined && !allowed.includes(v)) errors.push(`${key}: "${v}" inválido (use ${allowed.join(', ')})`);
  }
  const rows = getAt(cfg, 'cockpit.rows');
  if (rows != null && !(Array.isArray(rows) && rows.every((r) => Array.isArray(r)))) {
    errors.push('cockpit.rows: precisa ser uma lista de linhas, cada uma uma lista de widgets');
  }
  const n = getAt(cfg, 'voice.maxSeconds');
  if (n !== undefined && !(Number.isFinite(n) && n > 0 && n <= 600)) errors.push('voice.maxSeconds: entre 1 e 600');
  return errors;
}

/** Raw user file (only what the user changed). */
export function loadUserConfig(paths = getPaths()) {
  const raw = readJson(paths.configFile, {});
  return isPlainObject(raw) ? raw : {};
}

/** Effective config = defaults + user file. Invalid values fall back to defaults. */
export function loadConfig(paths = getPaths()) {
  let user = {};
  try {
    user = loadUserConfig(paths);
  } catch {
    user = {};
  }
  const merged = deepMerge(structuredClone(DEFAULTS), user);
  for (const key of Object.keys(ENUMS)) {
    const v = getAt(merged, key);
    if (!ENUMS[key].includes(v)) setAt(merged, key, getAt(DEFAULTS, key));
  }
  return merged;
}

/** Persist one key into the user file (backup first). Throws on invalid value. */
export function setConfigValue(dotted, value, paths = getPaths()) {
  // Strict: a hand-edited file with a syntax error is never replaced by a one-key file.
  const user = readJsonForUpdate(paths.configFile, {});
  setAt(user, dotted, value);
  const errors = validate(deepMerge(structuredClone(DEFAULTS), user));
  if (errors.length) throw new Error(errors.join('\n'));
  backupFile(paths.configFile, paths.backups, 'config.json');
  writeJsonAtomic(paths.configFile, user);
  return user;
}

/** Create the config file if missing. Never overwrites. */
export function ensureConfig(paths = getPaths()) {
  fs.mkdirSync(paths.userThemes, { recursive: true });
  if (!fs.existsSync(paths.configFile)) {
    writeJsonAtomic(paths.configFile, { $schemaVersion: 1, theme: { name: DEFAULTS.theme.name } });
    return true;
  }
  return false;
}

/** Parse a CLI value: true/false/null/numbers/JSON, otherwise string. */
export function parseValue(s) {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^[[{]/.test(s)) {
    try { return JSON.parse(s); } catch { /* keep as string */ }
  }
  return s;
}
