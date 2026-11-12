// Unit tests for the voice engine's pure logic. No microphone, no PowerShell, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { parseHotkey, MOD } from '../apps/voice-engine/src/hotkey.js';
import { cleanTranscript, finalizeText } from '../apps/voice-engine/src/text.js';
import { buildWhisperArgs, defaultThreads } from '../apps/voice-engine/src/whisper.js';
import { parseLine, createLineDecoder, encodeCommand } from '../apps/voice-engine/src/protocol.js';
import { buildHostArgs, eventName } from '../apps/voice-engine/src/host.js';
import { MODELS, PINNED_RELEASE, pickRelease, modelUrl, formatBytes, download, resolveModel, resolveWhisperBinary } from '../apps/voice-engine/src/assets.js';
import { resolveOptions, cleanTempDir } from '../apps/voice-engine/src/engine.js';
import { planSetup, runSetup, pruneWhisperDir } from '../apps/voice-engine/src/setup.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'td-voice-test-'));
const fakeVp = (root) => ({
  root, whisperDir: path.join(root, 'whisper'), modelsDir: path.join(root, 'models'), tmp: path.join(root, 'tmp'),
  cache: path.join(root, 'cache'), downloads: path.join(root, 'downloads'), manifest: path.join(root, 'install.json'),
});

// ---- hotkey ---------------------------------------------------------------------

test('parseHotkey: Ctrl+Alt+Space (old default, still accepted)', () => {
  const h = parseHotkey('Ctrl+Alt+Space');
  assert.equal(h.modifiers, MOD.CTRL | MOD.ALT);
  assert.equal(h.vk, 0x20);
  assert.equal(h.label, 'Ctrl+Alt+Space');
});

test('parseHotkey: case, spaces, aliases and canonical order', () => {
  const h = parseHotkey(' shift + control + v ');
  assert.equal(h.modifiers, MOD.CTRL | MOD.SHIFT);
  assert.equal(h.vk, 0x56);
  assert.equal(h.label, 'Ctrl+Shift+V');
  assert.equal(parseHotkey('Win+Alt+1').vk, 0x31);
  assert.equal(parseHotkey('Win+Alt+1').modifiers, MOD.WIN | MOD.ALT);
});

test('parseHotkey: function keys alone are allowed, F1..F24 map to 0x70..0x87', () => {
  assert.deepEqual([parseHotkey('F9').vk, parseHotkey('F9').modifiers], [0x78, 0]);
  assert.equal(parseHotkey('Ctrl+F24').vk, 0x87);
  assert.equal(parseHotkey('ScrollLock').vk, 0x91);
  assert.equal(parseHotkey('Alt+`').vk, 0xc0);
});

test('parseHotkey: rejects bad input with pt-BR messages', () => {
  assert.throws(() => parseHotkey(''), /vazio/);
  assert.throws(() => parseHotkey('Ctrl+Alt'), /tecla principal/);
  assert.throws(() => parseHotkey('Ctrl+A+B'), /mais de uma/);
  assert.throws(() => parseHotkey('Ctrl+Banana'), /desconhecida/);
  assert.throws(() => parseHotkey('A'), /sem modificador/);
  assert.throws(() => parseHotkey('Shift+A'), /Shift sozinho/);
  assert.throws(() => parseHotkey('Ctrl+Ctrl+A'), /repetido/);
  assert.throws(() => parseHotkey('F25'), /desconhecida/);
});

// ---- text cleanup ---------------------------------------------------------------

test('cleanTranscript: joins segments and trims', () => {
  assert.equal(cleanTranscript('\r\n Olá, tudo bem?\n Vamos começar.\n'), 'Olá, tudo bem? Vamos começar.');
});

test('cleanTranscript: removes non-speech markers', () => {
  assert.equal(cleanTranscript('[BLANK_AUDIO]'), '');
  assert.equal(cleanTranscript(' [Música] (risos) bom dia [ Silence ]'), 'bom dia');
  assert.equal(cleanTranscript('♪ la la la ♪'), '');
  assert.equal(cleanTranscript('*music* hello'), 'hello');
  assert.equal(cleanTranscript('olá [aplausos] , mundo'), 'olá, mundo');
});

test('cleanTranscript: keeps long parentheticals that are real speech', () => {
  assert.equal(cleanTranscript('o plano (que discutimos ontem à tarde) segue'), 'o plano (que discutimos ontem à tarde) segue');
});

test('cleanTranscript: strips timestamps if present', () => {
  assert.equal(cleanTranscript('[00:00:00.000 --> 00:00:02.000]   teste um'), 'teste um');
});

test('cleanTranscript: drops whole-text hallucinations only', () => {
  assert.equal(cleanTranscript(' Legendas pela comunidade Amara.org'), '');
  assert.equal(cleanTranscript('Obrigado por assistir!'), '');
  assert.equal(cleanTranscript('Thank you for watching.'), '');
  assert.equal(cleanTranscript('obrigado por assistir à reunião de hoje'), 'obrigado por assistir à reunião de hoje');
});

test('cleanTranscript: punctuation-only and control chars', () => {
  assert.equal(cleanTranscript(' ... '), '');
  assert.equal(cleanTranscript('a\u0007b\tc'), 'a b c');
  assert.equal(cleanTranscript(null), '');
});

test('finalizeText honors appendSpace', () => {
  assert.equal(finalizeText('oi'), 'oi ');
  assert.equal(finalizeText('oi', { appendSpace: false }), 'oi');
  assert.equal(finalizeText('', { appendSpace: true }), '');
});

// ---- whisper args ---------------------------------------------------------------

test('buildWhisperArgs: language, threads, no timestamps/prints', () => {
  const a = buildWhisperArgs({ model: 'm.bin', wav: 'a.wav', language: 'pt', threads: 4 });
  assert.deepEqual(a, ['-m', 'm.bin', '-f', 'a.wav', '-l', 'pt', '-t', '4', '-nt', '-np']);
  assert.equal(buildWhisperArgs({ model: 'm', wav: 'w', language: 'auto', threads: 2 })[5], 'auto');
  assert.equal(buildWhisperArgs({ model: 'm', wav: 'w', language: 'en', threads: 2 })[5], 'en');
  const p = buildWhisperArgs({ model: 'm', wav: 'w', threads: 1, prompt: 'Olá.' });
  assert.deepEqual(p.slice(-2), ['--prompt', 'Olá.']);
});

test('buildWhisperArgs: validation', () => {
  assert.throws(() => buildWhisperArgs({ wav: 'w' }), /modelo/);
  assert.throws(() => buildWhisperArgs({ model: 'm' }), /áudio/);
  assert.throws(() => buildWhisperArgs({ model: 'm', wav: 'w', language: 'fr' }), /idioma/);
});

test('defaultThreads is clamped to 1..8', () => {
  assert.equal(defaultThreads(32), 8);
  assert.equal(defaultThreads(2), 2);
  assert.equal(defaultThreads(0), 4);
});

// ---- protocol -------------------------------------------------------------------

test('parseLine: accepts only known events', () => {
  assert.deepEqual(parseLine('{"event":"audio","path":"C:\\\\x.wav","peak":3}'), { event: 'audio', path: 'C:\\x.wav', peak: 3 });
  assert.equal(parseLine('\uFEFF{"event":"ready"}').event, 'ready');
  assert.equal(parseLine('WARNING: something'), null);
  assert.equal(parseLine('{"event":"nope"}'), null);
  assert.equal(parseLine('{"cmd":"type"}'), null);
  assert.equal(parseLine('{broken'), null);
  assert.equal(parseLine('[1,2]'), null);
});

test('createLineDecoder: handles split chunks, CRLF, multibyte UTF-8 across chunks', () => {
  const got = [];
  const other = [];
  const d = createLineDecoder((m) => got.push(m), (l) => other.push(l));
  const bytes = Buffer.from('{"event":"typed","chars":3}\r\nruído\n{"event":"warn","message":"ação"}\n{"event":"quit"}', 'utf8');
  const cut = bytes.indexOf(Buffer.from('çã')) + 1; // split inside a multibyte char
  d.push(bytes.subarray(0, 10));
  d.push(bytes.subarray(10, cut));
  d.push(bytes.subarray(cut));
  assert.equal(got.length, 2);
  d.end();
  assert.deepEqual(got.map((m) => m.event), ['typed', 'warn', 'quit']);
  assert.equal(got[1].message, 'ação');
  assert.deepEqual(other, ['ruído']);
});

test('encodeCommand: one line, validated, newlines escaped', () => {
  const line = encodeCommand({ cmd: 'type', text: 'a\nb "c"' });
  assert.ok(line.endsWith('\n'));
  assert.equal(line.trimEnd().includes('\n'), false);
  assert.deepEqual(JSON.parse(line), { cmd: 'type', text: 'a\nb "c"' });
  assert.throws(() => encodeCommand({ cmd: 'rm' }), /inválido/);
});

test('host event names avoid EventEmitter "error"', () => {
  assert.equal(eventName('error'), 'host-error');
  assert.equal(eventName('audio'), 'audio');
});

test('buildHostArgs: flags map to voice-host.ps1 parameters', () => {
  const a = buildHostArgs({ mode: 'listen', hotkey: parseHotkey('Ctrl+Alt+Space'), trigger: 'toggle', maxSeconds: 30, device: 1, insertMode: 'paste', outDir: 'O', cacheDir: 'C', overlay: false, tray: false, script: 'h.ps1' });
  assert.deepEqual(a.slice(0, 9), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', 'h.ps1', '-Mode', 'listen']);
  const kv = (k) => a[a.indexOf(k) + 1];
  assert.equal(kv('-Modifiers'), '3');
  assert.equal(kv('-Vk'), '32');
  assert.equal(kv('-HotkeyLabel'), 'Ctrl+Alt+Space');
  assert.equal(kv('-Trigger'), 'toggle');
  assert.equal(kv('-MaxSeconds'), '30');
  assert.equal(kv('-Device'), '1');
  assert.equal(kv('-InsertMode'), 'paste');
  assert.ok(a.includes('-NoOverlay') && a.includes('-NoTray'));
  assert.equal(buildHostArgs({ mode: 'devices' }).includes('-Modifiers'), false);
  // Mic button: on by default in listen mode, -NoButton when disabled, never in record/devices runs.
  assert.equal(buildHostArgs({ mode: 'listen' }).includes('-NoButton'), false);
  assert.equal(buildHostArgs({ mode: 'listen', button: false }).includes('-NoButton'), true);
  assert.equal(buildHostArgs({ mode: 'record', button: true }).includes('-NoButton'), true);
  assert.equal(buildHostArgs({ mode: 'devices' }).includes('-NoButton'), true);
});

// ---- assets / setup -------------------------------------------------------------

test('model catalog: multilingual models with SHA-1 and HF URL', () => {
  assert.deepEqual(Object.keys(MODELS), ['tiny', 'base', 'small', 'medium']);
  for (const m of Object.values(MODELS)) assert.match(m.sha1, /^[0-9a-f]{40}$/);
  assert.equal(modelUrl('base'), 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin');
  assert.throws(() => modelUrl('large'), /desconhecido/);
  assert.match(PINNED_RELEASE.sha256, /^[0-9a-f]{64}$/);
  assert.match(PINNED_RELEASE.url, /^https:\/\/github\.com\/ggml-org\/whisper\.cpp\/releases\/download\//);
});

test('pickRelease: newest release that ships the x64 zip, digest parsed', () => {
  const releases = [
    { tag_name: 'v9.9.9', assets: [] },
    { tag_name: 'b2', draft: true, assets: [{ name: 'whisper-bin-x64.zip' }] },
    { tag_name: 'b1', assets: [{ name: 'whisper-bin-x64.zip', size: 10, digest: 'sha256:' + 'a'.repeat(64), browser_download_url: 'https://x/z.zip' }] },
  ];
  assert.deepEqual(pickRelease(releases), { tag: 'b1', version: 'b1', asset: 'whisper-bin-x64.zip', size: 10, sha256: 'a'.repeat(64), url: 'https://x/z.zip' });
  assert.equal(pickRelease([{ tag_name: 'b0', assets: [{ name: 'whisper-bin-x64.zip', size: 1 }] }]).sha256, null);
  assert.equal(pickRelease([]), null);
});

test('formatBytes', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(147951465), '141.1 MB');
  assert.equal(formatBytes(1533763059), '1.4 GB');
});

function fakeFetch(body) {
  return async () => new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
}

test('download: verifies SHA-1/SHA-256/size and never leaves a bad file', async () => {
  const dir = tmp();
  const body = Buffer.from('conteúdo do modelo');
  const sha1 = crypto.createHash('sha1').update(body).digest('hex');
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  const dest = path.join(dir, 'ok.bin');
  const got = await download('https://x', dest, { sha1, sha256, size: body.length, fetchImpl: fakeFetch(body) });
  assert.equal(got.sha1, sha1);
  assert.deepEqual(fs.readFileSync(dest), body);

  const bad = path.join(dir, 'bad.bin');
  await assert.rejects(download('https://x', bad, { sha1: '0'.repeat(40), fetchImpl: fakeFetch(body) }), /SHA-1 não confere/);
  assert.equal(fs.existsSync(bad), false);
  assert.equal(fs.existsSync(`${bad}.part`), false);
  await assert.rejects(download('https://x', bad, { size: 1, fetchImpl: fakeFetch(body) }), /tamanho/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('resolve binary/model: explicit > config > installed', () => {
  const root = tmp();
  const vp = fakeVp(root);
  const exe = path.join(root, 'my-whisper.exe');
  fs.writeFileSync(exe, '');
  const saved = process.env.TD_WHISPER_CLI;
  delete process.env.TD_WHISPER_CLI;
  try {
    assert.equal(resolveWhisperBinary({ vp }).exists, false);
    assert.equal(resolveWhisperBinary({ config: { voice: { whisperPath: exe } }, vp }).source, 'config voice.whisperPath');
    assert.equal(resolveWhisperBinary({ explicit: exe, config: { voice: { whisperPath: 'nope' } }, vp }).source, 'opção --whisper');
    const installed = path.join(vp.whisperDir, 'b1', 'Release', 'whisper-cli.exe');
    fs.mkdirSync(path.dirname(installed), { recursive: true });
    fs.writeFileSync(installed, '');
    assert.equal(resolveWhisperBinary({ vp }).path, installed);
  } finally {
    if (saved !== undefined) process.env.TD_WHISPER_CLI = saved;
  }
  const m = resolveModel({ config: { voice: { model: 'tiny' } }, vp });
  assert.equal(m.path, path.join(vp.modelsDir, 'ggml-tiny.bin'));
  assert.equal(m.exists, false);
  assert.equal(resolveModel({ explicit: exe, vp }).source, 'opção --model-path');
  fs.rmSync(root, { recursive: true, force: true });
});

test('setup: plan lists sources/sizes and nothing is downloaded without confirmation', async () => {
  const root = tmp();
  const vp = fakeVp(root);
  const saved = process.env.TD_WHISPER_CLI;
  delete process.env.TD_WHISPER_CLI;
  try {
    const plan = await planSetup({ config: { voice: { model: 'tiny' } }, vp });
    assert.deepEqual(plan.items.map((i) => i.kind), ['whisper', 'model']);
    assert.equal(plan.items[1].size, MODELS.tiny.size);
    assert.equal(plan.items[0].url, PINNED_RELEASE.url);
    let asked = null;
    const res = await runSetup(plan, { confirm: async (q) => { asked = q; return false; }, vp });
    assert.equal(res.cancelled, true);
    assert.match(asked, /Baixar 2 arquivo/);
    assert.equal(fs.existsSync(vp.downloads), false);
    assert.equal(fs.existsSync(vp.modelsDir), false);
  } finally {
    if (saved !== undefined) process.env.TD_WHISPER_CLI = saved;
    fs.rmSync(root, { recursive: true, force: true });
  }
  await assert.rejects(planSetup({ model: 'large', vp }), /modelo inválido/);
});

test('setup --latest: refuses a binary without published digest unless allowUnverified', async () => {
  const root = tmp();
  const vp = fakeVp(root);
  const saved = process.env.TD_WHISPER_CLI;
  delete process.env.TD_WHISPER_CLI;
  const api = (digest) => async () => new Response(JSON.stringify([
    { tag_name: 'b9', assets: [{ name: 'whisper-bin-x64.zip', size: 5, browser_download_url: 'https://x/z.zip', ...(digest ? { digest } : {}) }] },
  ]), { status: 200 });
  try {
    await assert.rejects(planSetup({ latest: true, vp, fetchImpl: api(null) }), /não publica hash.*--allow-unverified/s);
    const p = await planSetup({ latest: true, allowUnverified: true, vp, fetchImpl: api(null) });
    assert.match(p.items[0].integrity, /NÃO VERIFICADO/);
    const ok = await planSetup({ latest: true, vp, fetchImpl: api('sha256:' + 'b'.repeat(64)) });
    assert.equal(ok.release.sha256, 'b'.repeat(64));
  } finally {
    if (saved !== undefined) process.env.TD_WHISPER_CLI = saved;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pruneWhisperDir keeps only whisper-cli + whisper/ggml DLLs (drops SDL2 and demos)', () => {
  const dir = tmp();
  const names = ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu-haswell.dll', 'ggml-cpu-x64.dll',
    'SDL2.dll', 'llama.dll', 'parakeet.dll', 'whisper-stream.exe', 'main.exe', 'test-vad.exe', 'whisper-server.exe'];
  for (const n of names) fs.writeFileSync(path.join(dir, n), '');
  const removed = pruneWhisperDir(dir);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['ggml-base.dll', 'ggml-cpu-haswell.dll', 'ggml-cpu-x64.dll', 'ggml.dll', 'whisper-cli.exe', 'whisper.dll']);
  assert.ok(removed.includes('SDL2.dll'));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- engine options -------------------------------------------------------------

test('resolveOptions: config.voice merged with overrides; undefined overrides ignored', () => {
  const vp = fakeVp(tmp());
  const o = resolveOptions({
    config: { voice: { hotkey: 'Ctrl+Alt+V', mode: 'toggle', language: 'en', model: 'small', appendSpace: false, maxSeconds: 30 } },
    overrides: { language: 'pt', mode: undefined },
    vp,
  });
  assert.equal(o.hotkey, 'Ctrl+Alt+V');
  assert.equal(o.mode, 'toggle');
  assert.equal(o.language, 'pt');
  assert.equal(o.modelName, 'small');
  assert.equal(o.appendSpace, false);
  assert.equal(o.maxSeconds, 30);
  assert.equal(o.button, true, 'button on by default');
  assert.equal(resolveOptions({ config: { voice: { button: false } }, vp }).button, false);
  assert.equal(resolveOptions({ config: { voice: { button: true } }, overrides: { button: false }, vp }).button, false);
  assert.equal(o.model.path, path.join(vp.modelsDir, 'ggml-small.bin'));
  fs.rmSync(vp.root, { recursive: true, force: true });
});

test('cleanTempDir removes only td-voice WAVs', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'td-voice-1-1.wav'), '');
  fs.writeFileSync(path.join(dir, 'td-voice-1-2.WAV'), '');
  fs.writeFileSync(path.join(dir, 'other.wav'), '');
  assert.equal(cleanTempDir(dir), 2);
  assert.deepEqual(fs.readdirSync(dir), ['other.wav']);
  assert.equal(cleanTempDir(path.join(dir, 'missing')), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
