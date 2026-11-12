// The voice engine: host events -> whisper -> cleaned text -> typed into the focused window.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { parseHotkey, DEFAULT_HOTKEY } from './hotkey.js';
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
    hotkey: v.hotkey ?? DEFAULT_HOTKEY,
    mode: v.mode ?? 'push-to-talk',
    language: v.language ?? 'pt',
    modelName: v.model ?? 'base',
    microphone: v.microphone ?? 'default',
    insertMode: v.insertMode ?? 'type',
    autoInsert: v.autoInsert ?? true,
    appendSpace: v.appendSpace ?? true,
    maxSeconds: Number(v.maxSeconds ?? 60),
    prompt: v.prompt ?? null,
    overlay: v.overlay ?? true,
    tray: v.tray ?? true,
    button: v.button ?? true,
    topmost: v.topmost ?? true,
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
    overlay: opts.overlay, tray: false, button: false,
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

/** Human message for a blocked/interrupted insertion reported by the host. */
export function blockedMessage(m) {
  const why = m.reason === 'focus' ? 'a janela em foco mudou depois que você começou a falar'
    : m.reason === 'modifier' ? `havia tecla pressionada (${m.keys || 'modificador'}) e digitar dispararia atalhos`
      : m.reason === 'no-target' ? 'nenhuma janela estava em foco quando a gravação começou'
        : m.reason === 'elevated' ? 'a janela de destino roda como administrador e o Windows descartaria a digitação'
          : 'o Windows recusou a digitação';
  const what = m.outcome === 'interrupted'
    ? `inserção interrompida depois de ${m.chars} de ${m.requested} caractere(s)`
    : 'inserção cancelada, nada foi digitado';
  return `${what}: ${why}`;
}

/**
 * Long-running engine. Events:
 *   'status' {state: 'starting'|'ready'|'recording'|'processing'|'typed'|'blocked'|'idle'|'stopped', message?}
 *   'transcript' {text, ms, durationMs}
 *   'blocked' {text, reason, keys, outcome, chars, requested, message}   text kept for manual copy
 *   'kept' {text, chars}   autoInsert off: nothing typed, text ready to copy (button, tray, Enter)
 *   'copied' {chars}
 *   'warn' {message}   'error' handled as 'fail' {message, fatal}
 *
 * `deps` replaces the host, whisper and readiness check in tests (no PowerShell, no audio).
 */
export function createEngine(opts, deps = {}) {
  const d = { startHost, transcribeFile, assertReady, ...deps };
  const em = new EventEmitter();
  const hk = parseHotkey(opts.hotkey);
  let host = null;
  let stopping = false;
  const queue = [];
  let busy = false;
  // Text sent for insertion, by recording id, until the host answers typed/blocked.
  const sentText = new Map();
  let lastBlocked = null;
  // Last transcription of this session (memory only). The user can always copy it.
  let lastText = null;

  const status = (state, message) => em.emit('status', { state, message });
  // Tell the host this recording will not be inserted, so its pending target is released.
  const drop = (audio) => host?.send({ cmd: 'drop', id: audio.id });

  async function processNext() {
    if (busy || queue.length === 0) return;
    busy = true;
    const audio = queue.shift();
    try {
      if (audio.peak < SILENCE_PEAK) {
        fs.rmSync(audio.path, { force: true });
        drop(audio);
        status('idle', 'silêncio: nada foi gravado (confira o microfone)');
        host?.send({ cmd: 'state', state: 'idle', message: 'só silêncio' });
        return;
      }
      status('processing');
      const { text, ms } = await d.transcribeFile(audio.path, opts);
      if (!text) {
        drop(audio);
        status('idle', 'nada reconhecido');
        host?.send({ cmd: 'state', state: 'idle', message: 'nada reconhecido' });
        return;
      }
      em.emit('transcript', { text, ms, durationMs: audio.durationMs });
      const final = finalizeText(text, opts);
      lastText = final;
      if (opts.autoInsert === false) {
        // Never types: the host releases the target and offers the text for copying.
        host?.send({ cmd: 'keep', id: audio.id, text: final });
        status('done', 'texto pronto para copiar');
        em.emit('kept', { text: final, chars: final.length });
        return;
      }
      sentText.set(audio.id, final);
      // Exactly one insertion request per recording; the host also refuses repeats.
      host?.send({ cmd: 'type', id: audio.id, text: final, insertMode: opts.insertMode });
    } catch (err) {
      drop(audio);
      em.emit('fail', { message: err.message, fatal: false });
      host?.send({ cmd: 'state', state: 'error', message: 'erro na transcrição' });
    } finally {
      busy = false;
      processNext();
    }
  }

  /** Last transcription that was not inserted (focus change, held key...), or null. */
  em.lastBlocked = () => lastBlocked;

  /** Last transcription of this session (inserted or not), or null. */
  em.lastText = () => lastText;

  /** Copy the last transcription to the clipboard (explicit user action only). */
  em.copyLast = () => {
    if (!lastText) return false;
    return host?.send({ cmd: 'copy' }) ?? false;
  };

  em.start = () => new Promise((resolve, reject) => {
    d.assertReady(opts);
    fs.mkdirSync(opts.vp.tmp, { recursive: true });
    cleanTempDir(opts.vp.tmp);
    status('starting');
    host = d.startHost({
      mode: 'listen', hotkey: hk, trigger: opts.mode, maxSeconds: opts.maxSeconds, device: opts.microphone,
      insertMode: opts.insertMode, outDir: opts.vp.tmp, cacheDir: opts.vp.cache, overlay: opts.overlay, tray: opts.tray,
      button: opts.button !== false, topmost: opts.topmost !== false,
    });
    let ready = false;
    host.on('ready', (m) => { ready = true; status('ready', m.device); resolve(m); });
    host.on('recording', (m) => status('recording', m?.source));
    host.on('audio', (m) => { queue.push(m); processNext(); });
    host.on('cancelled', (m) => status('idle', m.reason === 'short' ? 'gravação muito curta, ignorada' : m.reason));
    host.on('typed', (m) => {
      sentText.delete(m.id);
      status('typed', `${m.chars} caractere(s)`);
      if (m.chars < m.requested) em.emit('warn', { message: 'parte do texto não foi digitada (janela elevada ou bloqueada?)' });
    });
    host.on('blocked', (m) => {
      const text = sentText.get(m.id) ?? '';
      sentText.delete(m.id);
      const message = blockedMessage(m);
      lastBlocked = { text, reason: m.reason, keys: m.keys || '', outcome: m.outcome, chars: m.chars, requested: m.requested, message };
      status('blocked', message);
      em.emit('blocked', lastBlocked);
    });
    host.on('copied', (m) => em.emit('copied', { chars: m.chars }));
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
