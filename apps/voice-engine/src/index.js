// Terminal-Design voice engine: offline push-to-talk dictation for Windows (whisper.cpp).
// Independent of the cockpit; `td voice` is just one consumer of this API.
//
//   import { resolveOptions, createEngine, setup, test, listDevices, status, doctor } from '.../voice-engine/src/index.js';
//   const opts = resolveOptions({ config });
//   const engine = createEngine(opts); await engine.start(); ... await engine.stop();
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolveOptions, createEngine, blockedMessage, listDevices, recordOnce, transcribeFile, assertReady, cleanTempDir, SILENCE_PEAK } from './engine.js';
import { planSetup, runSetup } from './setup.js';
import { MODELS, PINNED_RELEASE, voicePaths, verifyModel, readManifest } from './assets.js';
import { HOST_SCRIPT, powershellExe } from './host.js';
import { parseHotkey, hotkeyWarnings } from './hotkey.js';
import { windowsPowerShellEnv } from '../../../packages/core/src/fs.js';

export { parseHotkey, hotkeyWarnings, DEFAULT_HOTKEY, MOD } from './hotkey.js';
export { cleanTranscript, finalizeText } from './text.js';
export { buildWhisperArgs, runWhisper, defaultThreads } from './whisper.js';
export { parseLine, createLineDecoder, encodeCommand } from './protocol.js';
export { buildHostArgs, startHost, HOST_SCRIPT } from './host.js';
export { MODELS, PINNED_RELEASE, voicePaths, pickRelease, formatBytes } from './assets.js';
export { enableAutostart, disableAutostart, autostartStatus, shortcutSpec, startupDir, shortcutPath, SHORTCUT_NAME } from './autostart.js';
export { resolveOptions, createEngine, blockedMessage, listDevices, recordOnce, transcribeFile, cleanTempDir, SILENCE_PEAK, planSetup, runSetup };

/** Plan + confirm + download. See setup.js for the details. */
export async function setup({ config, model, latest, force, allowUnverified, whisperPath, modelPath, confirm, log } = {}) {
  const plan = await planSetup({ config, model, latest, force, allowUnverified, whisperPath, modelPath });
  return { plan, ...(await runSetup(plan, { confirm, log })) };
}

/** Record N seconds and return the transcription (nothing is typed, the WAV is deleted). */
export async function test(opts, { seconds = 5, onRecording, onProcessing } = {}) {
  assertReady(opts);
  const audio = await recordOnce(opts, { seconds, onRecording });
  if (audio.peak < SILENCE_PEAK) {
    fs.rmSync(audio.path, { force: true });
    return { text: '', silent: true, peak: audio.peak, durationMs: audio.durationMs };
  }
  onProcessing?.(audio);
  const r = await transcribeFile(audio.path, opts);
  return { ...r, silent: false, peak: audio.peak, durationMs: audio.durationMs };
}

/** Static status, no subprocesses. */
export function status(opts) {
  const man = readManifest(opts.vp);
  let hotkey;
  try { hotkey = parseHotkey(opts.hotkey).label; } catch (e) { hotkey = `inválido: ${e.message}`; }
  return {
    platform: process.platform,
    whisper: { ...opts.whisper, tag: man.whisper?.tag ?? null },
    model: { ...opts.model, size: opts.model.exists ? fs.statSync(opts.model.path).size : null },
    hotkey,
    mode: opts.mode,
    language: opts.language,
    microphone: opts.microphone,
    insertMode: opts.insertMode,
    autoInsert: opts.autoInsert,
    button: opts.button,
    topmost: opts.topmost,
    dataDir: opts.vp.root,
    hostScript: HOST_SCRIPT,
  };
}

/** Health checks: [{ name, ok: true|false|null, detail }]. */
export async function doctor(opts, { probeMic = true } = {}) {
  if (process.platform !== 'win32') {
    return [{ name: 'voz', ok: null, detail: 'disponível só no Windows' }];
  }
  const checks = [];

  try {
    const hk = parseHotkey(opts.hotkey);
    const w = hotkeyWarnings(hk);
    checks.push({ name: 'Atalho de voz', ok: w.length ? null : true, detail: w.length ? w.join(' ') : `${hk.label} (${opts.mode})` });
  } catch (e) {
    checks.push({ name: 'Atalho de voz', ok: false, detail: e.message });
  }

  const ps = spawnSync(powershellExe(), ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8', windowsHide: true, timeout: 20000, env: windowsPowerShellEnv() });
  const psOk = ps.status === 0;
  checks.push({ name: 'PowerShell', ok: psOk, detail: psOk ? `Windows PowerShell ${ps.stdout.trim()}` : `powershell.exe indisponível (${ps.error?.message ?? ps.stderr?.trim()})` });

  if (!opts.whisper.exists) {
    // Voice is optional: "not set up yet" is a warning (null). A configured path that is missing is an error.
    const explicit = opts.whisper.source && !/td voice setup/.test(opts.whisper.source);
    checks.push({ name: 'whisper.cpp', ok: explicit ? false : null, detail: explicit ? `não encontrado: ${opts.whisper.path} (${opts.whisper.source})` : 'não instalado, opcional (td voice setup)' });
  } else {
    const r = spawnSync(opts.whisper.path, ['--help'], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    const ran = r.status === 0 || /usage/i.test(`${r.stdout}${r.stderr}`);
    checks.push({ name: 'whisper.cpp', ok: ran, detail: ran ? `${opts.whisper.path} (${opts.whisper.source})` : `não executa: ${opts.whisper.path} (faltam DLLs?)` });
  }

  if (!opts.model.exists) {
    const explicitModel = opts.model.source === 'config voice.modelPath' || opts.model.source === 'opção --model-path';
    checks.push({ name: 'modelo', ok: explicitModel ? false : null, detail: `${opts.model.path ?? opts.modelName} ausente${explicitModel ? '' : ', opcional'} (td voice setup --model=${opts.modelName})` });
  } else if (opts.model.name && MODELS[opts.model.name]) {
    const v = await verifyModel(opts.model.path, opts.model.name, { vp: opts.vp });
    checks.push({ name: `modelo ${opts.model.name}`, ok: v.ok, detail: v.detail });
  } else {
    checks.push({ name: 'modelo', ok: null, detail: `${opts.model.path} (externo, sem hash conhecido)` });
  }


  if (probeMic && psOk) {
    try {
      const devices = await listDevices(opts);
      const want = String(opts.microphone ?? 'default');
      let ok = devices.length > 0 ? true : null; // no microphone: voice unavailable, not an install error
      let detail = ok ? `${devices.length} encontrado(s): ${devices.map((d) => `${d.index}=${d.name}`).join(', ')}` : 'nenhum microfone encontrado';
      if (ok && want !== 'default') {
        const match = /^\d+$/.test(want)
          ? devices.find((d) => d.index === Number(want))
          : devices.find((d) => d.name.toLowerCase().includes(want.toLowerCase()));
        if (!match) { ok = false; detail = `voice.microphone "${want}" não corresponde a nenhum: ${detail}`; }
      }
      checks.push({ name: 'microfone', ok, detail });
    } catch (e) {
      checks.push({ name: 'microfone', ok: null, detail: `não foi possível listar: ${e.message}` });
    }
  }
  return checks;
}

export { readManifest, PINNED_RELEASE as WHISPER_RELEASE };
