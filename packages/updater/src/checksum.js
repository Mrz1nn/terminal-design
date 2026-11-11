import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * Parse a SHA256SUMS file (`sha256sum` format): "<64 hex>  <name>" or "<64 hex> *<name>".
 * Returns Map<name, lowercase hex>. Blank lines and # comments are ignored; other lines throw.
 */
export function parseChecksums(text) {
  const map = new Map();
  for (const rawLine of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line);
    if (!m) throw new Error(`linha inválida no arquivo de checksums: ${line.slice(0, 80)}`);
    const name = m[2].trim().replace(/^\.\//, '');
    if (map.has(name) && map.get(name) !== m[1].toLowerCase()) throw new Error(`checksum duplicado e diferente para ${name}`);
    map.set(name, m[1].toLowerCase());
  }
  return map;
}

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

/** Format lines for SHA256SUMS.txt. */
export function formatChecksums(entries) {
  return entries.map(({ name, hash }) => `${hash}  ${name}`).join('\n') + '\n';
}

/**
 * Verify `data` (Buffer) against the checksum listed for `name`.
 * Throws when the entry is missing or different. Returns the hash on success.
 */
export function verifyChecksum(data, name, checksumsText) {
  const map = parseChecksums(checksumsText);
  const expected = map.get(name);
  if (!expected) throw new Error(`o arquivo de checksums não tem entrada para ${name}; atualização recusada`);
  const actual = sha256(data);
  if (actual !== expected) {
    throw new Error(`checksum SHA-256 não confere para ${name} (esperado ${expected.slice(0, 12)}…, obtido ${actual.slice(0, 12)}…); atualização recusada`);
  }
  return actual;
}
