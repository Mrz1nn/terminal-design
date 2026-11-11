// Minimal ZIP writer/reader (store + deflate, no zip64, no encryption). Node built-ins only.
//
// The writer builds release archives (scripts/pack-release.js). The reader lists and
// validates archive entries before anything is extracted, so a malicious archive can
// never write outside the staging folder ("zip slip"), and it is the extraction
// fallback when tar.exe is not available.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Fixed timestamp (2020-01-01 00:00) so the same sources always produce the same zip bytes.
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

/**
 * Create a zip file.
 * @param {{name: string, data: Buffer}[]} entries  name uses forward slashes
 * @param {string} outFile
 */
export function createZip(entries, outFile) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    assertSafeEntryName(name);
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    if (body.length >= 0xffffffff || data.length >= 0xffffffff) throw new Error(`arquivo grande demais para zip: ${name}`);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // UTF-8 names
    lh.writeUInt16LE(useDeflate ? 8 : 0, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // made by (MS-DOS / FAT)
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(useDeflate ? 8 : 0, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    // extra len, comment len, disk start, internal attrs = 0
    ch.writeUInt32LE(0, 38); // external attrs
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.concat([...locals, cd, eocd]));
}

/** Throws if a zip entry name could escape the extraction folder or is otherwise unsafe. */
export function assertSafeEntryName(name) {
  const n = String(name);
  // eslint-disable-next-line no-control-regex
  if (!n || /[\x00-\x1f:*?"<>|]/.test(n) || n.includes('\\')) throw new Error(`nome inválido no pacote: ${JSON.stringify(n)}`);
  if (n.startsWith('/')) throw new Error(`caminho absoluto no pacote: ${n}`);
  const segs = n.split('/');
  if (segs.some((s) => s === '..')) throw new Error(`caminho com ".." no pacote: ${n}`);
  if (segs.slice(0, -1).some((s) => s === '' || s === '.')) throw new Error(`caminho inválido no pacote: ${n}`);
  if (segs.some((s) => /[. ]$/.test(s) && s !== '' && s !== '.')) throw new Error(`nome inválido no Windows: ${n}`);
}

/** List entries of a zip buffer: [{name, method, crc, compressedSize, size, dataOffset, isDir}] */
export function readZipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('arquivo zip inválido (fim do diretório não encontrado)');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff || p + cdSize > buf.length) throw new Error('zip64 ou zip corrompido não é suportado');
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip corrompido (diretório central)');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new Error(`zip criptografado não é suportado: ${name}`);
    if (method !== 0 && method !== 8) throw new Error(`método de compressão não suportado (${method}): ${name}`);
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`zip corrompido: ${name}`);
    const isDir = name.endsWith('/');
    assertSafeEntryName(isDir ? name.slice(0, -1) : name);
    const dataOffset = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (dataOffset + compressedSize > buf.length) throw new Error(`zip truncado: ${name}`);
    entries.push({ name, method, crc, compressedSize, size, dataOffset, isDir });
  }
  return entries;
}

function entryData(buf, e) {
  const raw = buf.subarray(e.dataOffset, e.dataOffset + e.compressedSize);
  const data = e.method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: Math.max(e.size, 1) }) : raw;
  if (data.length !== e.size || crc32(data) !== e.crc) throw new Error(`CRC inválido no pacote: ${e.name}`);
  return data;
}

function windowsTar() {
  if (process.platform !== 'win32') return null;
  const t = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return fs.existsSync(t) ? t : null;
}

/**
 * Extract `zipFile` into `dest` (created, must be empty or missing).
 * Entries are validated first; then tar.exe (Windows built-in) extracts, or the
 * pure-Node reader when tar.exe is missing or `useTar` is false.
 */
export function extractZip(zipFile, dest, { useTar = true } = {}) {
  const buf = fs.readFileSync(zipFile);
  const entries = readZipEntries(buf);
  fs.mkdirSync(dest, { recursive: true });
  const tar = useTar ? windowsTar() : null;
  if (tar) {
    const r = spawnSync(tar, ['-x', '-f', zipFile, '-C', dest], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
    if (r.status === 0) return { method: 'tar.exe', count: entries.length };
    // fall through to the Node extractor on any tar failure
  }
  const root = path.resolve(dest);
  for (const e of entries) {
    const target = path.resolve(root, ...e.name.split('/').filter(Boolean));
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`caminho fora da pasta: ${e.name}`);
    if (e.isDir) { fs.mkdirSync(target, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entryData(buf, e));
  }
  return { method: 'node', count: entries.length };
}
