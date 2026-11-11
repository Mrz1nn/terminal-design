// whisper.cpp binary + ggml model catalog, locations, download and integrity checks.
//
// Sources (both MIT licensed):
//   binary  https://github.com/ggml-org/whisper.cpp/releases  (asset whisper-bin-x64.zip)
//   models  https://huggingface.co/ggerganov/whisper.cpp       (ggml-<name>.bin, weights from OpenAI Whisper)
//
// Integrity:
//   models  SHA-1 published by whisper.cpp in models/README.md (hardcoded below).
//   binary  SHA-256 published by GitHub as the release asset "digest" (hardcoded for the pinned
//           release; read from the GitHub API when --latest is used).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { getPaths, readJson, writeJsonAtomic } from '../../../packages/core/src/index.js';

// Upstream tags the Windows binaries on "bNNNN" builds; the "vX.Y.Z" release itself has no assets.
// Verified 2026-11-11 via https://api.github.com/repos/ggml-org/whisper.cpp/releases
export const PINNED_RELEASE = Object.freeze({
  tag: 'b5454',
  version: 'v1.9.5',
  asset: 'whisper-bin-x64.zip',
  size: 8928640,
  sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb',
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip',
});

// SHA-1 from https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md
// Sizes from the Hugging Face X-Linked-Size header (bytes).
export const MODELS = Object.freeze({
  tiny: { file: 'ggml-tiny.bin', size: 77691713, sha1: 'bd577a113a864445d4c299885e0cb97d4ba92b5f' },
  base: { file: 'ggml-base.bin', size: 147951465, sha1: '465707469ff3a37a2b9b8d8f89f2f99de7299dac' },
  small: { file: 'ggml-small.bin', size: 487601967, sha1: '55356645c2b361a969dfd0ef2c5a50d530afd8d5' },
  medium: { file: 'ggml-medium.bin', size: 1533763059, sha1: 'fd9727b6e1217c2f614f9b698455c4ffd82463b4' },
});

export const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
const GITHUB_API = 'https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=15';
const USER_AGENT = 'terminal-design-voice';

export function modelUrl(name) {
  const m = MODELS[name];
  if (!m) throw new Error(`modelo desconhecido: ${name} (use ${Object.keys(MODELS).join(', ')})`);
  return MODEL_BASE_URL + m.file;
}

export function voicePaths(paths = getPaths()) {
  const root = paths.voice;
  return {
    root,
    whisperDir: path.join(root, 'whisper'),
    modelsDir: path.join(root, 'models'),
    tmp: path.join(root, 'tmp'),
    cache: path.join(root, 'cache'),
    downloads: path.join(root, 'downloads'),
    manifest: path.join(root, 'install.json'),
  };
}

export function readManifest(vp = voicePaths()) {
  const m = readJson(vp.manifest, {});
  return { whisper: null, models: {}, ...m };
}

export function writeManifest(manifest, vp = voicePaths()) {
  writeJsonAtomic(vp.manifest, manifest);
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '?';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i >= 2 ? 1 : 0)} ${u[i]}`;
}

/** Recursively find a file by (case-insensitive) name. */
export function findFile(dir, name, depth = 4) {
  if (depth < 0 || !fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return p;
  }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const r = findFile(path.join(dir, e.name), name, depth - 1);
      if (r) return r;
    }
  }
  return null;
}

/**
 * Where is whisper-cli.exe? Order: explicit option > config voice.whisperPath > env TD_WHISPER_CLI
 * > installed by `td voice setup`. Returns { path, source } or { path: null }.
 */
export function resolveWhisperBinary({ explicit, config, vp = voicePaths() } = {}) {
  const candidates = [
    [explicit, 'opção --whisper'],
    [config?.voice?.whisperPath, 'config voice.whisperPath'],
    [process.env.TD_WHISPER_CLI, 'variável TD_WHISPER_CLI'],
  ];
  for (const [p, source] of candidates) {
    if (p) return { path: path.resolve(p), source, exists: fs.existsSync(p) };
  }
  const man = readManifest(vp);
  if (man.whisper?.path && fs.existsSync(man.whisper.path)) return { path: man.whisper.path, source: `td voice setup (${man.whisper.tag})`, exists: true };
  const found = findFile(vp.whisperDir, 'whisper-cli.exe');
  if (found) return { path: found, source: 'td voice setup', exists: true };
  return { path: null, source: null, exists: false };
}

/** Model file. Order: explicit option > config voice.modelPath > installed model of the configured size. */
export function resolveModel({ explicit, config, name, vp = voicePaths() } = {}) {
  const modelName = name ?? config?.voice?.model ?? 'base';
  if (explicit) return { path: path.resolve(explicit), name: null, source: 'opção --model-path', exists: fs.existsSync(explicit) };
  if (config?.voice?.modelPath) {
    const p = config.voice.modelPath;
    return { path: path.resolve(p), name: null, source: 'config voice.modelPath', exists: fs.existsSync(p) };
  }
  if (!MODELS[modelName]) return { path: null, name: modelName, source: null, exists: false };
  const p = path.join(vp.modelsDir, MODELS[modelName].file);
  return { path: p, name: modelName, source: 'td voice setup', exists: fs.existsSync(p) };
}

export async function hashFile(file, algo) {
  const h = crypto.createHash(algo);
  await pipeline(fs.createReadStream(file), async function* (src) {
    for await (const chunk of src) h.update(chunk);
  });
  return h.digest('hex');
}

/**
 * Verify a known model, caching the result in install.json by size+mtime so `td doctor`
 * does not re-hash 1.5 GB every time. Returns { ok, detail }.
 */
export async function verifyModel(file, name, { vp = voicePaths(), force = false } = {}) {
  const meta = MODELS[name];
  if (!meta) return { ok: null, detail: 'modelo externo, hash não conhecido' };
  const st = fs.statSync(file);
  const man = readManifest(vp);
  const cached = man.models?.[name];
  if (!force && cached?.verified && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
    return { ok: cached.sha1 === meta.sha1, detail: `SHA-1 ${cached.sha1.slice(0, 12)}… (verificado em ${cached.verified.slice(0, 10)})` };
  }
  const sha1 = await hashFile(file, 'sha1');
  man.models = { ...man.models, [name]: { path: file, size: st.size, mtimeMs: st.mtimeMs, sha1, verified: new Date().toISOString() } };
  writeManifest(man, vp);
  return { ok: sha1 === meta.sha1, detail: sha1 === meta.sha1 ? `SHA-1 confere (${sha1.slice(0, 12)}…)` : `SHA-1 diferente: ${sha1} (esperado ${meta.sha1})` };
}

/** Ask the GitHub API for the newest build that ships whisper-bin-x64.zip. */
export async function fetchLatestRelease({ fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(GITHUB_API, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub API respondeu ${res.status}`);
  return pickRelease(await res.json());
}

/** Pure: choose the first release (newest first) carrying the x64 CPU asset. */
export function pickRelease(releases, assetName = PINNED_RELEASE.asset) {
  for (const r of releases ?? []) {
    if (r.draft) continue;
    const a = (r.assets ?? []).find((x) => x.name === assetName);
    if (!a) continue;
    const digest = typeof a.digest === 'string' && a.digest.startsWith('sha256:') ? a.digest.slice(7) : null;
    return { tag: r.tag_name, version: r.tag_name, asset: a.name, size: a.size, sha256: digest, url: a.browser_download_url };
  }
  return null;
}

/**
 * Stream a URL to `dest` (via dest.part), hashing on the fly. Verifies size and hash when given.
 * onProgress(received, total).
 */
export async function download(url, dest, { sha1, sha256, size, onProgress, fetchImpl = globalThis.fetch } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download falhou (${res.status}) ${url}`);
  const total = Number(res.headers.get('content-length')) || size || 0;
  const h1 = crypto.createHash('sha1');
  const h256 = crypto.createHash('sha256');
  let received = 0;
  let lastTick = 0;
  try {
    await pipeline(
      Readable.fromWeb(res.body),
      async function* (src) {
        for await (const chunk of src) {
          h1.update(chunk);
          h256.update(chunk);
          received += chunk.length;
          const now = Date.now();
          if (onProgress && (now - lastTick > 200 || received === total)) { lastTick = now; onProgress(received, total); }
          yield chunk;
        }
      },
      fs.createWriteStream(part),
    );
  } catch (err) {
    fs.rmSync(part, { force: true });
    throw err;
  }
  onProgress?.(received, total);
  const got = { sha1: h1.digest('hex'), sha256: h256.digest('hex'), size: received };
  const fail = (msg) => { fs.rmSync(part, { force: true }); throw new Error(msg); };
  if (size && received !== size) fail(`tamanho inesperado: ${received} bytes (esperado ${size})`);
  if (sha1 && got.sha1 !== sha1) fail(`SHA-1 não confere: ${got.sha1} (esperado ${sha1})`);
  if (sha256 && got.sha256 !== sha256) fail(`SHA-256 não confere: ${got.sha256} (esperado ${sha256})`);
  fs.renameSync(part, dest);
  return got;
}

/** Windows' own bsdtar (C:\Windows\System32\tar.exe) extracts zip; Git's GNU tar on PATH does not. */
export function windowsTar() {
  const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return fs.existsSync(sys) ? sys : 'tar';
}

export function extractZip(zip, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const r = spawnSync(windowsTar(), ['-xf', zip, '-C', destDir], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`tar.exe não conseguiu extrair ${path.basename(zip)}: ${(r.stderr || r.error?.message || '').trim()}`);
}
