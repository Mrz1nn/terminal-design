// Spawns and talks to the native host (native/voice-host.ps1 -> voice-host.cs).
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createLineDecoder, encodeCommand } from './protocol.js';
import { windowsPowerShellEnv } from '../../../packages/core/src/fs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const HOST_SCRIPT = path.resolve(here, '..', 'native', 'voice-host.ps1');

export function powershellExe() {
  const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return sys;
}

/** Pure: powershell.exe argument vector for a host run. */
export function buildHostArgs({
  mode = 'listen', hotkey, trigger = 'push-to-talk', maxSeconds = 60, seconds = 5,
  device = 'default', insertMode = 'type', outDir, cacheDir, overlay = true, tray = true, button = true,
  script = HOST_SCRIPT,
} = {}) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', script, '-Mode', mode];
  if (hotkey) args.push('-Modifiers', String(hotkey.modifiers), '-Vk', String(hotkey.vk), '-HotkeyLabel', hotkey.label);
  args.push('-Trigger', trigger, '-MaxSeconds', String(Math.round(maxSeconds)), '-Seconds', String(Math.round(seconds)));
  args.push('-Device', String(device ?? 'default'), '-InsertMode', insertMode);
  if (outDir) args.push('-OutDir', outDir);
  if (cacheDir) args.push('-CacheDir', cacheDir);
  if (!overlay) args.push('-NoOverlay');
  if (!tray) args.push('-NoTray');
  // The floating mic button only exists in listen mode; never pass it for record/devices runs.
  if (!button || mode !== 'listen') args.push('-NoButton');
  return args;
}

// 'error' is special in EventEmitter (throws without a listener), so host errors become 'host-error'.
export const eventName = (e) => (e === 'error' ? 'host-error' : e);

/**
 * Start the host. Returns an EventEmitter that re-emits every protocol event by name
 * ('ready', 'audio', ..., 'host-error') plus 'exit' (code) and 'noise' (non-protocol output line).
 * host.send({cmd:...}) writes a command; host.stop() asks it to quit and kills it after 2 s.
 */
export function startHost(options = {}) {
  const em = new EventEmitter();
  const child = spawn(powershellExe(), buildHostArgs(options), {
    windowsHide: true,
    env: windowsPowerShellEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let exited = false;
  const decoder = createLineDecoder((msg) => em.emit(eventName(msg.event), msg), (line) => em.emit('noise', line));
  child.stdout.on('data', (d) => decoder.push(d));
  child.stderr.on('data', (d) => em.emit('noise', d.toString('utf8').trim()));
  child.on('error', (err) => {
    em.emit('host-error', { event: 'error', code: 'spawn', message: `não foi possível iniciar o PowerShell: ${err.message}` });
    // A failed spawn may never emit 'close'.
    if (!exited && child.pid === undefined) { exited = true; em.emit('exit', -1); }
  });
  child.on('close', (code) => {
    if (exited) return;
    exited = true;
    decoder.end();
    em.emit('exit', code);
  });
  child.stdin.on('error', () => {}); // EPIPE when the host already exited

  em.child = child;
  em.send = (cmd) => {
    if (exited || !child.stdin.writable) return false;
    child.stdin.write(encodeCommand(cmd));
    return true;
  };
  em.stop = () => new Promise((resolve) => {
    if (exited) return resolve();
    em.once('exit', () => resolve());
    em.send({ cmd: 'quit' });
    child.stdin.end();
    setTimeout(() => { if (!exited) child.kill(); }, 2000).unref();
  });
  return em;
}

/** Run the host once to completion, collecting events. Resolves { events, code }. */
export function runHostOnce(options, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    const host = startHost(options);
    const events = [];
    const noise = [];
    for (const name of ['ready', 'recording', 'audio', 'cancelled', 'devices', 'warn', 'host-error']) {
      host.on(name, (msg) => events.push(msg));
    }
    host.on('noise', (l) => noise.push(l));
    const timer = setTimeout(() => host.child.kill(), timeoutMs);
    host.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ events, code, noise });
    });
  });
}
