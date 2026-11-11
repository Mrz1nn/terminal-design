// `td voice setup`: download whisper.cpp + a model, only after explicit confirmation.
import fs from 'node:fs';
import path from 'node:path';
import {
  PINNED_RELEASE, MODELS, modelUrl, voicePaths, readManifest, writeManifest, formatBytes,
  resolveWhisperBinary, resolveModel, verifyModel, fetchLatestRelease, download, extractZip, findFile,
} from './assets.js';

/**
 * Build the download plan without touching the network (unless latest=true, which asks GitHub).
 * Returns { items: [{kind, label, url, size, integrity, license, dest}], release, modelName }.
 */
export async function planSetup({ config, model, latest = false, force = false, allowUnverified = false, whisperPath, modelPath, vp = voicePaths(), fetchImpl } = {}) {
  const modelName = model ?? config?.voice?.model ?? 'base';
  if (!MODELS[modelName]) throw new Error(`modelo inválido: ${modelName} (use ${Object.keys(MODELS).join(', ')})`);
  const items = [];
  let release = null;

  const bin = resolveWhisperBinary({ explicit: whisperPath, config, vp });
  if (force || !bin.exists) {
    release = latest ? await fetchLatestRelease(fetchImpl ? { fetchImpl } : {}) : PINNED_RELEASE;
    if (!release) throw new Error('nenhuma release do whisper.cpp com whisper-bin-x64.zip foi encontrada');
    // An executable we cannot verify is never installed silently: it would be run on every dictation.
    if (!release.sha256 && !allowUnverified) {
      throw new Error(`a build ${release.tag} não publica hash (digest) no GitHub; sem verificação o binário não é instalado. ` +
        'Rode sem --latest (build fixada e verificada) ou, por sua conta, com --allow-unverified');
    }
    items.push({
      kind: 'whisper',
      label: `whisper.cpp ${release.tag} (${release.asset}, CPU x64)`,
      url: release.url,
      size: release.size,
      integrity: release.sha256 ? `SHA-256 ${release.sha256.slice(0, 16)}… (publicado pelo GitHub)` : 'NÃO VERIFICADO (--allow-unverified): sem hash publicado, SHA-256 só será registrado',
      license: 'MIT (ggml-org/whisper.cpp)',
    });
  }

  const m = resolveModel({ explicit: modelPath, config, name: modelName, vp });
  if (m.source === 'td voice setup' && (force || !m.exists)) {
    const meta = MODELS[modelName];
    items.push({
      kind: 'model',
      label: `modelo ${modelName} multilíngue (${meta.file})`,
      url: modelUrl(modelName),
      size: meta.size,
      integrity: `SHA-1 ${meta.sha1.slice(0, 16)}… (publicado no README do whisper.cpp)`,
      license: 'MIT (pesos do OpenAI Whisper, convertidos por ggerganov)',
    });
  }
  return { items, release, modelName };
}

/**
 * Execute a plan. `confirm(question)` must resolve true, otherwise nothing is downloaded.
 * log: { info, ok, warn, progress(label, received, total) }
 */
export async function runSetup(plan, { confirm, log = {}, vp = voicePaths() } = {}) {
  const say = { info: () => {}, ok: () => {}, warn: () => {}, progress: () => {}, ...log };
  if (plan.items.length === 0) {
    say.ok('whisper.cpp e modelo já instalados. Use --force para baixar de novo.');
    return { downloaded: [] };
  }
  const total = plan.items.reduce((n, i) => n + (i.size || 0), 0);
  const ok = await confirm(`Baixar ${plan.items.length} arquivo(s), ${formatBytes(total)} no total, para ${vp.root}?`);
  if (!ok) {
    say.warn('nada foi baixado.');
    return { downloaded: [], cancelled: true };
  }

  const done = [];
  for (const item of plan.items) {
    if (item.kind === 'whisper') done.push(await installWhisper(plan.release, { say, vp }));
    else done.push(await installModel(plan.modelName, { say, vp }));
  }
  return { downloaded: done };
}

async function installWhisper(release, { say, vp }) {
  const zip = path.join(vp.downloads, `${release.tag}-${release.asset}`);
  say.info(`baixando ${release.url}`);
  const got = await download(release.url, zip, {
    sha256: release.sha256 ?? undefined,
    size: release.size,
    onProgress: (r, t) => say.progress('whisper.cpp', r, t),
  });
  if (!release.sha256) say.warn(`binário NÃO verificado (--allow-unverified); SHA-256 registrado: ${got.sha256}`);
  else say.ok(`SHA-256 confere (${got.sha256.slice(0, 16)}…)`);

  const dest = path.join(vp.whisperDir, release.tag);
  fs.rmSync(dest, { recursive: true, force: true });
  extractZip(zip, dest);
  fs.rmSync(zip, { force: true });
  const exe = findFile(dest, 'whisper-cli.exe');
  if (!exe) throw new Error(`whisper-cli.exe não encontrado dentro de ${release.asset}`);
  const removed = pruneWhisperDir(path.dirname(exe));
  if (removed.length) say.info(`${removed.length} arquivo(s) de exemplo do pacote removidos (só whisper-cli e as DLLs do ggml ficam)`);
  const man = readManifest(vp);
  man.whisper = { tag: release.tag, asset: release.asset, url: release.url, sha256: got.sha256, publishedDigest: !!release.sha256, path: exe, installed: new Date().toISOString() };
  writeManifest(man, vp);
  say.ok(`whisper-cli instalado em ${exe}`);
  return { kind: 'whisper', path: exe };
}

async function installModel(name, { say, vp }) {
  const meta = MODELS[name];
  const dest = path.join(vp.modelsDir, meta.file);
  say.info(`baixando ${modelUrl(name)}`);
  await download(modelUrl(name), dest, { sha1: meta.sha1, size: meta.size, onProgress: (r, t) => say.progress(`modelo ${name}`, r, t) });
  // Records the verified hash in install.json so `td doctor` does not re-hash.
  await verifyModel(dest, name, { vp, force: true });
  say.ok(`modelo ${name} instalado e verificado (SHA-1 ${meta.sha1.slice(0, 12)}…)`);
  return { kind: 'model', path: dest };
}

// whisper-cli.exe only needs whisper.dll + ggml*.dll (ggml-cpu-*.dll are CPU backends loaded at
// runtime by ggml). The release zip also ships demos (stream, command, talk-llama, wchess, parakeet,
// tests) and SDL2.dll used only by those. Removing them keeps the install minimal and means no
// SDL2 (zlib license) or other extra code is kept on disk.
export const KEEP_FILES = [/^whisper-cli\.exe$/i, /^whisper\.dll$/i, /^ggml(-[a-z0-9]+)*\.dll$/i];

/** Delete everything in the extracted folder except what whisper-cli needs. Returns removed names. */
export function pruneWhisperDir(dir) {
  const removed = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && KEEP_FILES.some((re) => re.test(e.name))) continue;
    fs.rmSync(path.join(dir, e.name), { recursive: true, force: true });
    removed.push(e.name);
  }
  return removed;
}
