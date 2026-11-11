// The voice engine: host events -> whisper -> cleaned text -> typed into the focused window.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { parseHotkey } from './hotkey.js';
import { cleanTranscript, finalizeText } from './text.js';
import { buildWhisperArgs, runWhisper } from './whisper.js';
import { startHost, runHostOnce } from './host.js';
import { voicePaths, resolveWhisperBinary, resolveModel } from './assets.js';

/** Audio whose loudest sample is below this (of 32767) is treated as silence and not transcribed. */
export const SILENCE_PEAK = 150;

/**
 * Merge config.voice with explicit overrides (CLI flags / API options) into one options object.
 * Pure apart from resolving file locations.
 */
export function resolveOptions({ config = {}, overrides = {}, vp = voicePaths() } = {}) {
  const v = { ...(config.voice ?? {}), ...stripUndefined(overrides) };
  const whisper = resolveWhisperBinary({ explicit: overrides.whisperPath, config, vp });
  const model = resolveModel({ explicit: overrides.modelPath, config, name: v.model, vp });
  return {
    hotkey: v.hotkey ?? 'Ctrl+Alt+Space',
    mode: v.mode ?? 'push-to-talk',
    language: v.language ?? 'pt',
    modelName: v.model ?? 'base',
    microphone: v.microphone ?? 'default',
    insertMode: v.insertMode ?? 'type',
    appendSpace: v.appendSpace ?? true,
    maxSeconds: Number(v.maxSeconds ?? 60),
    prompt: v.prompt ?? null,
    overlay: v.overlay ?? true,
    tray: v.tray ?? true,
    whisper,
    model,
    vp,
  };
}

function stripUndefined(o) {
  return Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined));
}

export function assertReady(opts) {
  if (process.platform !== 'win32') throw new Error('a digitação por voz funciona só no Windows por enquanto');
  if (!opts.whisper.exists) {
    throw new Error(opts.whisper.path
      ? `whisper-cli não encontrado em ${opts.whisper.path} (${opts.whisper.source})`
      : 'whisper.cpp não instalado: rode td voice setup');
  }
  if (!opts.model.exists) {
    throw new Error(opts.model.path
      ? `modelo não encontrado em ${opts.model.path}: rode td voice setup${opts.model.name ? ` --model=${opts.model.name}` : ''}`
      : `modelo inválido: ${opts.modelName}`);
  }
}

/** Remove WAVs left behind by a crash (they are only ever ours: td-voice-*.wav). */
export function cleanTempDir(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (/^td-voice-.*\.wav$/i.test(f)) { fs.rmSync(path.join(dir, f), { force: true }); n++; }
  }
  return n;
}

/** Transcribe one WAV. The file is ALWAYS deleted afterwards (audio is never kept). */
export async function transcribeFile(wav, opts, { keep = false } = {}) {
  try {
    const args = buildWhisperArgs({ model: opts.model.path, wav, language: opts.language, prompt: opts.prompt });
    const { text: raw, ms } = await runWhisper(opts.whisper.path, args);
    return { raw, text: cleanTranscript(raw), ms };
  } finally {
    if (!keep) fs.rmSync(wav, { force: true });
  }
}

/** List microphones via waveIn. */
export async function listDevices(opts) {
  const { events } = await runHostOnce({ mode: 'devices', cacheDir: opts.vp.cache, outDir: opts.vp.tmp }, { timeoutMs: 30000 });
  const err = events.find((e) => e.event === 'error');
  if (err) throw new Error(err.message);
  const list = events.find((e) => e.event === 'devices');
  if (!list) throw new Error('o host de voz não respondeu com a lista de microfones');
  return list.devices;
}

/** Record `seconds` of audio (no hotkey, no typing). Resolves { path, durationMs, peak } or throws. */
export async function recordOnce(opts, { seconds = 5, onRecording } = {}) {
  fs.mkdirSync(opts.vp.tmp, { recursive: true });
  const host = startHost({
    mode: 'record', seconds, device: opts.microphone, outDir: opts.vp.tmp, cacheDir: opts.vp.cache,
    overlay: opts.overlay, tray: false,
  });
  return new Promise((resolve, reject) => {
    let audio = null;
    let error = null;
    let cancelled = null;
    host.on('recording', (m) => onRecording?.(m));
    host.on('audio', (m) => { audio = m; host.stop(); });
    host.on('cancelled', (m) => { cancelled = m; });
    host.on('host-error', (m) => { error = error ?? m; });
    const timer = setTimeout(() => host.child.kill(), (seconds + 30) * 1000);
    host.on('exit', () => {
      clearTimeout(timer);
      if (audio) resolve(audio);
      else reject(new Error(error?.message ?? (cancelled ? 'gravação muito curta' : 'o host de voz terminou sem áudio')));
    });
  });
}

/**
 * Long-running engine. Events:
 *   'status' {state: 'starting'|'ready'|'recording'|'processing'|'typed'|'idle'|'stopped', message?}
 *   'transcript' {text, ms, durationMs}
 *   'warn' {message}   'error' handled as 'fail' {message, fatal}
 */
export function createEngine(opts) {
  const em = new EventEmitter();
  const hk = parseHotkey(opts.hotkey);
  let host = null;
  let stopping = false;
  const queue = [];
  let busy = false;

  const status = (state, message) => em.emit('status', { state, message });

  async function processNext() {
    if (busy || queue.length === 0) return;
    busy = true;
    const audio = queue.shift();
    try {
      if (audio.peak < SILENCE_PEAK) {
        fs.rmSync(audio.path, { force: true });
        status('idle', 'silêncio: nada foi gravado (confira o microfone)');
        host?.send({ cmd: 'state', state: 'idle', message: 'só silêncio' });
        return;
      }
      status('processing');
      const { text, ms } = await transcribeFile(audio.path, opts);
      if (!text) {
        status('idle', 'nada reconhecido');
        host?.send({ cmd: 'state', state: 'idle', message: 'nada reconhecido' });
        return;
      }
      em.emit('transcript', { text, ms, durationMs: audio.durationMs });
      host?.send({ cmd: 'type', text: finalizeText(text, opts), insertMode: opts.insertMode });
    } catch (err) {
      em.emit('fail', { message: err.message, fatal: false });
      host?.send({ cmd: 'state', state: 'error', message: 'erro na transcrição' });
    } finally {
      busy = false;
      processNext();
    }
  }

  em.start = () => new Promise((resolve, reject) => {
    assertReady(opts);
    fs.mkdirSync(opts.vp.tmp, { recursive: true });
    cleanTempDir(opts.vp.tmp);
    status('starting');
    host = startHost({
      mode: 'listen', hotkey: hk, trigger: opts.mode, maxSeconds: opts.maxSeconds, device: opts.microphone,
      insertMode: opts.insertMode, outDir: opts.vp.tmp, cacheDir: opts.vp.cache, overlay: opts.overlay, tray: opts.tray,
    });
    let ready = false;
    host.on('ready', (m) => { ready = true; status('ready', m.device); resolve(m); });
    host.on('recording', () => status('recording'));
    host.on('audio', (m) => { queue.push(m); processNext(); });
    host.on('cancelled', (m) => status('idle', m.reason === 'short' ? 'gravação muito curta, ignorada' : m.reason));
    host.on('typed', (m) => {
      status('typed', `${m.chars} caractere(s)`);
      if (m.chars < m.requested) em.emit('warn', { message: 'parte do texto não foi digitada (janela elevada ou bloqueada?)' });
    });
    host.on('warn', (m) => em.emit('warn', { message: m.message }));
    host.on('host-error', (m) => {
      if (!ready) reject(new Error(m.message));
      else em.emit('fail', { message: m.message, fatal: false });
    });
    host.on('noise', (line) => em.emit('debug', line));
    host.on('quit', () => { stopping = true; });
    host.on('exit', (code) => {
      // Never leave a WAV behind, whatever happened.
      for (const a of queue.splice(0)) fs.rmSync(a.path, { force: true });
      if (!ready) reject(new Error(`o host de voz terminou antes de ficar pronto (código ${code})`));
      status('stopped', stopping ? null : `host terminou (código ${code})`);
      em.emit('exit', code);
    });
  });

  em.stop = async () => {
    stopping = true;
    if (host) await host.stop();
    cleanTempDir(opts.vp.tmp);
  };
  return em;
}
