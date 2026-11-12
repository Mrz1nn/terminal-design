// Voice engine safety (R1/R2/R3) on the Node side, with a fake host: no PowerShell,
// no hotkey, no microphone, no keystrokes, no clipboard access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createEngine, blockedMessage } from '../apps/voice-engine/src/engine.js';
import { parseHotkey, hotkeyWarnings, DEFAULT_HOTKEY } from '../apps/voice-engine/src/hotkey.js';
import { parseLine, encodeCommand } from '../apps/voice-engine/src/protocol.js';
import { DEFAULTS } from '../packages/config/src/defaults.js';

const tmpRoots = [];
process.on('exit', () => tmpRoots.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function fakeHost() {
  const h = new EventEmitter();
  h.sent = [];
  h.send = (cmd) => { encodeCommand(cmd); h.sent.push(cmd); return true; }; // also validates the command
  h.stop = async () => { h.emit('exit', 0); };
  h.child = { kill() {} };
  return h;
}

function setup({ transcript = 'olá mundo', fail = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'td-voice-guard-'));
  tmpRoots.push(root);
  const vp = { root, tmp: path.join(root, 'tmp'), cache: path.join(root, 'cache') };
  const opts = {
    hotkey: DEFAULT_HOTKEY, mode: 'push-to-talk', language: 'pt', insertMode: 'type', appendSpace: true,
    maxSeconds: 60, microphone: 'default', overlay: false, tray: false, vp,
    whisper: { exists: true, path: 'x' }, model: { exists: true, path: 'y' },
  };
  const host = fakeHost();
  const transcribed = [];
  const engine = createEngine(opts, {
    startHost: () => host,
    assertReady: () => {},
    transcribeFile: async (wav) => {
      transcribed.push(wav);
      fs.rmSync(wav, { force: true });
      if (fail) throw new Error(fail);
      return { text: transcript, ms: 5 };
    },
  });
  const events = [];
  for (const e of ['blocked', 'copied', 'transcript', 'fail', 'warn']) engine.on(e, (m) => events.push([e, m]));
  return { engine, host, vp, events, transcribed, engineOpts: opts };
}

async function started(s) {
  const p = s.engine.start();
  s.host.emit('ready', { device: 'mic' });
  await p;
}

function audio(s, id, peak = 5000) {
  const file = path.join(s.vp.tmp, `td-voice-1-${id}.wav`);
  fs.mkdirSync(s.vp.tmp, { recursive: true });
  fs.writeFileSync(file, 'RIFF');
  s.host.emit('audio', { id, path: file, durationMs: 1500, peak });
  return file;
}

const tick = () => new Promise((r) => setTimeout(r, 20));
const types = (s) => s.host.sent.filter((c) => c.cmd === 'type');

test('one insertion request per recording, tagged with the recording id', async () => {
  const s = setup();
  await started(s);
  audio(s, 1);
  await tick();
  assert.equal(types(s).length, 1);
  assert.deepEqual(types(s)[0], { cmd: 'type', id: 1, text: 'olá mundo ', insertMode: 'type' });
  s.host.emit('typed', { id: 1, chars: 10, requested: 10 });
  s.host.emit('typed', { id: 1, chars: 10, requested: 10 }); // duplicate host answer
  await tick();
  assert.equal(types(s).length, 1, 'never re-sent');
});

test('two recordings are processed in order, each inserted once', async () => {
  const s = setup();
  await started(s);
  audio(s, 1);
  audio(s, 2);
  await tick();
  assert.deepEqual(types(s).map((c) => c.id), [1, 2]);
  assert.equal(s.transcribed.length, 2);
});

test('focus change: transcription preserved, user told why, copy offered', async () => {
  const s = setup({ transcript: 'texto importante' });
  await started(s);
  audio(s, 3);
  await tick();
  s.host.emit('blocked', { id: 3, outcome: 'blocked', reason: 'focus', keys: '', chars: 0, requested: 17 });
  const [name, b] = s.events.find(([e]) => e === 'blocked');
  assert.equal(name, 'blocked');
  assert.equal(b.text, 'texto importante ');
  assert.match(b.message, /cancelada.*janela em foco mudou/);
  assert.equal(s.engine.lastBlocked().text, 'texto importante ');
  assert.equal(s.engine.copyLast(), true);
  assert.deepEqual(s.host.sent.at(-1), { cmd: 'copy' });
  s.host.emit('copied', { chars: 17 });
  assert.ok(s.events.some(([e, m]) => e === 'copied' && m.chars === 17));
  assert.equal(types(s).length, 1, 'no automatic retry');
});

test('held modifier: message names the keys, text preserved', async () => {
  const s = setup({ transcript: 'abc' });
  await started(s);
  audio(s, 4);
  await tick();
  s.host.emit('blocked', { id: 4, outcome: 'blocked', reason: 'modifier', keys: 'Ctrl+Shift', chars: 0, requested: 4 });
  const b = s.engine.lastBlocked();
  assert.match(b.message, /Ctrl\+Shift/);
  assert.match(b.message, /atalhos/);
  assert.equal(b.text, 'abc ');
});

test('interrupted insertion reports how much was typed', () => {
  assert.match(blockedMessage({ outcome: 'interrupted', reason: 'focus', chars: 32, requested: 100 }), /interrompida depois de 32 de 100/);
  assert.match(blockedMessage({ outcome: 'blocked', reason: 'no-target' }), /nenhuma janela/);
});

test('silence, nothing recognized and errors release the pending target (drop) and type nothing', async () => {
  const quiet = setup();
  await started(quiet);
  const f = audio(quiet, 5, 10);
  await tick();
  assert.deepEqual(quiet.host.sent.find((c) => c.cmd === 'drop'), { cmd: 'drop', id: 5 });
  assert.equal(types(quiet).length, 0);
  assert.equal(fs.existsSync(f), false, 'WAV deleted');

  const empty = setup({ transcript: '' });
  await started(empty);
  audio(empty, 6);
  await tick();
  assert.deepEqual(empty.host.sent.find((c) => c.cmd === 'drop'), { cmd: 'drop', id: 6 });
  assert.equal(types(empty).length, 0);

  const broken = setup({ fail: 'whisper caiu' });
  await started(broken);
  audio(broken, 7);
  await tick();
  assert.deepEqual(broken.host.sent.find((c) => c.cmd === 'drop'), { cmd: 'drop', id: 7 });
  assert.equal(types(broken).length, 0);
  assert.ok(broken.events.some(([e]) => e === 'fail'));
});

test('copyLast without a preserved transcription does nothing', async () => {
  const s = setup();
  await started(s);
  assert.equal(s.engine.copyLast(), false);
  assert.equal(s.host.sent.filter((c) => c.cmd === 'copy').length, 0);
});

test('stopping deletes queued audio, nothing is typed after stop', async () => {
  const s = setup();
  await started(s);
  await s.engine.stop();
  assert.equal(types(s).length, 0);
});

test('protocol knows the new events and commands', () => {
  assert.equal(parseLine('{"event":"blocked","id":1,"reason":"focus"}').reason, 'focus');
  assert.equal(parseLine('{"event":"copied","chars":3}').chars, 3);
  assert.match(encodeCommand({ cmd: 'drop', id: 1 }), /"drop"/);
  assert.match(encodeCommand({ cmd: 'copy' }), /"copy"/);
  assert.throws(() => encodeCommand({ cmd: 'typeall' }));
});

test('R3: default hotkey has no Alt (AltGr-safe) and is the config default', () => {
  const hk = parseHotkey(DEFAULT_HOTKEY);
  assert.equal(hk.label, 'Ctrl+Shift+F9');
  assert.equal(hk.modifiers & 0x1, 0, 'no Alt');
  assert.equal(DEFAULTS.voice.hotkey, DEFAULT_HOTKEY);
  assert.deepEqual(hotkeyWarnings(hk), []);
});

test('R3: Ctrl+Alt + typing key warns about AltGr; F-keys and Win combos do not', () => {
  assert.equal(hotkeyWarnings(parseHotkey('Ctrl+Alt+Space')).length, 1);
  assert.equal(hotkeyWarnings(parseHotkey('Ctrl+Alt+Q')).length, 1);
  assert.equal(hotkeyWarnings(parseHotkey('Ctrl+Alt+F5')).length, 0);
  assert.equal(hotkeyWarnings(parseHotkey('Ctrl+Alt+Win+Space')).length, 0);
  assert.equal(hotkeyWarnings(parseHotkey('Ctrl+Shift+Space')).length, 0);
});

// ---- mic button (click to talk) ---------------------------------------------------

test('engine starts the host with the button on by default and off with button:false', async () => {
  for (const [button, expected] of [[undefined, true], [true, true], [false, false]]) {
    const s = setup();
    let hostOpts = null;
    const engine = createEngine({ ...s.engineOpts, button }, {
      startHost: (o) => { hostOpts = o; return s.host; },
      assertReady: () => {},
      transcribeFile: async () => ({ text: 'x', ms: 1 }),
    });
    const p = engine.start();
    s.host.emit('ready', { device: 'mic', button: expected });
    const ready = await p;
    assert.equal(hostOpts.button, expected, `button=${button}`);
    assert.equal(ready.button, expected);
  }
});

test('a recording started by the button reports its source in the status', async () => {
  const s = setup();
  const statuses = [];
  s.engine.on('status', (st) => statuses.push(st));
  await started(s);
  s.host.emit('recording', { device: 'mic', source: 'button', target: true });
  assert.deepEqual(statuses.at(-1), { state: 'recording', message: 'button' });
});

test('audio stopped by a button click (reason "button") follows the same single-insertion path', async () => {
  const s = setup();
  await started(s);
  const file = path.join(s.vp.tmp, 'td-voice-1-5.wav');
  fs.mkdirSync(s.vp.tmp, { recursive: true });
  fs.writeFileSync(file, 'RIFF');
  s.host.emit('audio', { id: 5, path: file, durationMs: 1200, peak: 4000, reason: 'button', source: 'button' });
  await tick();
  assert.deepEqual(types(s), [{ cmd: 'type', id: 5, text: 'olá mundo ', insertMode: 'type' }]);
  assert.equal(fs.existsSync(file), false, 'WAV deleted');
  s.host.emit('blocked', { id: 5, outcome: 'blocked', reason: 'no-target', keys: '', chars: 0, requested: 10 });
  await tick();
  const blocked = s.events.find(([e]) => e === 'blocked');
  assert.ok(blocked, 'no-target is reported as blocked');
  assert.equal(blocked[1].text, 'olá mundo ');
  assert.equal(types(s).length, 1, 'never re-sent');
});

test('protocol: recording/audio with source and ready with button parse as known events', () => {
  assert.equal(parseLine('{"event":"recording","device":"m","source":"tray","target":false}').source, 'tray');
  assert.equal(parseLine('{"event":"audio","id":1,"path":"p","reason":"button","source":"button"}').reason, 'button');
  assert.equal(parseLine('{"event":"ready","hotkey":"Ctrl+Shift+F9","button":true}').button, true);
});

// ---- optional auto-insert, copy always available, topmost -------------------------

test('autoInsert off: never asks the host to type; keeps the text for copying', async () => {
  const s = setup({ transcript: 'só copiar' });
  const engine = createEngine({ ...s.engineOpts, autoInsert: false }, {
    startHost: () => s.host, assertReady: () => {},
    transcribeFile: async (wav) => { fs.rmSync(wav, { force: true }); return { text: 'só copiar', ms: 3 }; },
  });
  const kept = [];
  const statuses = [];
  engine.on('kept', (m) => kept.push(m));
  engine.on('status', (st) => statuses.push(st.state));
  const p = engine.start();
  s.host.emit('ready', { device: 'mic' });
  await p;
  audio(s, 9);
  await tick();
  assert.equal(types(s).length, 0, 'nothing typed');
  assert.deepEqual(s.host.sent.find((c) => c.cmd === 'keep'), { cmd: 'keep', id: 9, text: 'só copiar ' });
  assert.deepEqual(kept, [{ text: 'só copiar ', chars: 10 }]);
  assert.ok(statuses.includes('done'));
  assert.equal(engine.lastText(), 'só copiar ');
  assert.equal(engine.copyLast(), true);
  assert.deepEqual(s.host.sent.at(-1), { cmd: 'copy' });
});

test('copy stays available after a successful insertion (explicit click only)', async () => {
  const s = setup({ transcript: 'inserido' });
  await started(s);
  assert.equal(s.engine.copyLast(), false, 'nothing yet');
  audio(s, 10);
  await tick();
  s.host.emit('typed', { id: 10, chars: 9, requested: 9 });
  assert.equal(s.engine.lastText(), 'inserido ');
  assert.equal(s.host.sent.filter((c) => c.cmd === 'copy').length, 0, 'never copies on its own');
  assert.equal(s.engine.copyLast(), true);
});

test('options: autoInsert and topmost default on, config and flags turn them off', async () => {
  const { resolveOptions } = await import('../apps/voice-engine/src/engine.js');
  const { voicePaths } = await import('../apps/voice-engine/src/assets.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-voice-opts-'));
  tmpRoots.push(dir);
  const vp = voicePaths({ voice: dir });
  const d = resolveOptions({ config: {}, vp });
  assert.equal(d.autoInsert, true);
  assert.equal(d.topmost, true);
  assert.equal(resolveOptions({ config: { voice: { autoInsert: false, topmost: false } }, vp }).autoInsert, false);
  assert.equal(resolveOptions({ config: { voice: { topmost: true } }, overrides: { topmost: false }, vp }).topmost, false);
  assert.equal(DEFAULTS.voice.autoInsert, true);
  assert.equal(DEFAULTS.voice.topmost, true);
});

test('host args: -NoTopmost only when the button exists and topmost is off', async () => {
  const { buildHostArgs } = await import('../apps/voice-engine/src/host.js');
  assert.equal(buildHostArgs({ mode: 'listen' }).includes('-NoTopmost'), false);
  assert.equal(buildHostArgs({ mode: 'listen', topmost: false }).includes('-NoTopmost'), true);
  assert.equal(buildHostArgs({ mode: 'listen', button: false, topmost: false }).includes('-NoTopmost'), false);
  assert.equal(buildHostArgs({ mode: 'record', topmost: false }).includes('-NoTopmost'), false);
});

test('engine passes topmost to the host', async () => {
  const s = setup();
  let hostOpts = null;
  const engine = createEngine({ ...s.engineOpts, topmost: false }, {
    startHost: (o) => { hostOpts = o; return s.host; }, assertReady: () => {}, transcribeFile: async () => ({ text: 'x', ms: 1 }),
  });
  const p = engine.start();
  s.host.emit('ready', { device: 'mic' });
  await p;
  assert.equal(hostOpts.topmost, false);
});

test('protocol knows keep/kept; elevated block has a clear message', () => {
  assert.equal(parseLine('{"event":"kept","id":1,"chars":3}').chars, 3);
  assert.match(encodeCommand({ cmd: 'keep', id: 1, text: 'a' }), /"keep"/);
  assert.match(blockedMessage({ outcome: 'blocked', reason: 'elevated' }), /administrador/);
});

test('config: on/off settings must be true or false; bad values fall back to the default', async () => {
  const { validate, loadConfig } = await import('../packages/config/src/index.js');
  assert.deepEqual(validate({ voice: { topmost: false, autoInsert: true } }), []);
  assert.match(validate({ voice: { topmost: 'nao' } }).join(), /voice\.topmost: use true ou false/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-cfg-bool-'));
  tmpRoots.push(dir);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ voice: { autoInsert: 'false', button: false } }));
  const cfg = loadConfig({ configFile: path.join(dir, 'config.json') });
  assert.equal(cfg.voice.autoInsert, true, 'string "false" is not trusted');
  assert.equal(cfg.voice.button, false);
});
