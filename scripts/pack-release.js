#!/usr/bin/env node
// Builds the release assets:
//   dist/terminal-design-<version>.zip   program files under terminal-design-<version>/
//   dist/SHA256SUMS.txt                  sha256sum format, verified by `td update`
//
//   node scripts/pack-release.js [--out=dist]
// Pure Node (no tar/zip tools needed), byte-for-byte reproducible for the same sources.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listProgramFiles } from '../packages/updater/src/files.js';
import { createZip, readZipEntries } from '../packages/updater/src/zip.js';
import { sha256File, formatChecksums } from '../packages/updater/src/checksum.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.slice(2).find((a) => a.startsWith('--out='));
const outDir = path.resolve(root, outArg ? outArg.slice(6) : 'dist');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const meta = pkg.terminalDesign ?? {};
const zipName = (meta.releaseAsset || 'terminal-design-{version}.zip').replace('{version}', version);
const sumName = meta.checksumAsset || 'SHA256SUMS.txt';
const prefix = `terminal-design-${version}`;

const files = listProgramFiles(root);
// Shell scripts must have LF line endings or macOS/Linux sh fails on "\r". A Windows
// checkout with core.autocrlf=true would otherwise ship CRLF ones.
const LF_ONLY = /\.(sh|bash|zsh|fish)$/;
const entries = files.map((rel) => {
  let data = fs.readFileSync(path.join(root, ...rel.split('/')));
  if (LF_ONLY.test(rel)) data = Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return { name: `${prefix}/${rel}`, data };
});

fs.mkdirSync(outDir, { recursive: true });
const zipFile = path.join(outDir, zipName);
createZip(entries, zipFile);

// self-check: the archive must read back cleanly with the same reader `td update` uses
const back = readZipEntries(fs.readFileSync(zipFile));
if (back.length !== entries.length) throw new Error('zip gerado não confere');

const hash = sha256File(zipFile);
fs.writeFileSync(path.join(outDir, sumName), formatChecksums([{ name: zipName, hash }]));

const size = (fs.statSync(zipFile).size / 1024).toFixed(1);
console.log(`✓ ${path.relative(root, zipFile)} (${files.length} arquivos, ${size} KB)`);
console.log(`✓ ${path.relative(root, path.join(outDir, sumName))}  ${hash}`);
