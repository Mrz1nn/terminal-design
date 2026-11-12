// `td voice autostart`: Startup-folder shortcut. Every test uses a temp APPDATA and a fake
// shortcut writer: the real Startup folder, the registry and PowerShell are never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startupDir, shortcutPath, shortcutSpec, enableAutostart, disableAutostart, autostartStatus, SHORTCUT_NAME,
} from '../apps/voice-engine/src/autostart.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = [];
process.on('exit', () => roots.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-autostart-'));
  roots.push(dir);
  const env = { APPDATA: path.join(dir, 'Roaming') };
  const paths = {
    appRoot: path.join(dir, 'clone'),
    dataHome: path.join(dir, 'Local', 'TerminalDesign'),
    binDir: path.join(dir, 'Local', 'TerminalDesign', 'bin'),
    voice: path.join(dir, 'Local', 'TerminalDesign', 'voice'),
  };
  const written = [];
  const deps = {
    platform: 'win32',
    env,
    writeShortcut: (file, spec) => { written.push({ file, spec }); fs.writeFileSync(file, `fake lnk -> ${spec.target} ${spec.args}`); },
  };
  return { dir, env, paths, deps, written };
}

test('Startup folder is the per-user one under APPDATA (no admin)', () => {
  const env = { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' };
  assert.equal(startupDir(env), path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'));
  assert.equal(path.basename(shortcutPath(env)), SHORTCUT_NAME);
  assert.throws(() => startupDir({}), /APPDATA/);
});

test('managed install: shortcut runs bin\\td.cmd voice (survives td update), minimized', () => {
  const s = sandbox();
  const spec = shortcutSpec(s.paths, { mode: 'managed' });
  assert.equal(spec.target, path.join(s.paths.binDir, 'td.cmd'));
  assert.equal(spec.args, 'voice');
  assert.equal(spec.windowStyle, 7);
  assert.doesNotMatch(spec.target, /versions/);
});

test('git clone: shortcut runs node with the clone td.js', () => {
  const s = sandbox();
  const spec = shortcutSpec(s.paths, { mode: 'dev', execPath: 'C:\\node\\node.exe' });
  assert.equal(spec.target, 'C:\\node\\node.exe');
  assert.equal(spec.args, `"${path.join(s.paths.appRoot, 'bin', 'td.js')}" voice`);
});

test('on: writes one shortcut and a record; status reports it; on again refreshes it', () => {
  const s = sandbox();
  fs.mkdirSync(s.paths.binDir, { recursive: true });
  fs.writeFileSync(path.join(s.paths.binDir, 'td.cmd'), '@echo off');
  assert.equal(autostartStatus(s.paths, s.deps).enabled, false);
  const r = enableAutostart(s.paths, { mode: 'managed' }, s.deps);
  assert.equal(r.file, shortcutPath(s.env));
  assert.equal(r.replaced, false);
  assert.ok(fs.existsSync(r.file));
  const st = autostartStatus(s.paths, s.deps);
  assert.equal(st.enabled, true);
  assert.equal(st.target, path.join(s.paths.binDir, 'td.cmd'));
  assert.equal(enableAutostart(s.paths, { mode: 'managed' }, s.deps).replaced, true);
  assert.equal(s.written.length, 2);
  assert.deepEqual(fs.readdirSync(startupDir(s.env)), [SHORTCUT_NAME]);
});

test('on refuses a managed install without td.cmd (would start nothing at login)', () => {
  const s = sandbox();
  assert.throws(() => enableAutostart(s.paths, { mode: 'managed' }, s.deps), /td\.cmd não existe/);
  assert.equal(s.written.length, 0);
});

test('on fails loudly when the writer did not create the file', () => {
  const s = sandbox();
  assert.throws(() => enableAutostart(s.paths, { mode: 'dev' }, { ...s.deps, writeShortcut: () => {} }), /não foi criado/);
});

test('off removes only our shortcut; other Startup items stay; off twice is fine', () => {
  const s = sandbox();
  enableAutostart(s.paths, { mode: 'dev' }, s.deps);
  const dir = startupDir(s.env);
  fs.writeFileSync(path.join(dir, 'OneDrive.lnk'), 'not ours');
  fs.writeFileSync(path.join(dir, 'desktop.ini'), 'not ours');
  const r = disableAutostart(s.paths, s.deps);
  assert.deepEqual(r.removed, [path.join(dir, SHORTCUT_NAME)]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['OneDrive.lnk', 'desktop.ini']);
  assert.equal(autostartStatus(s.paths, s.deps).enabled, false);
  assert.deepEqual(disableAutostart(s.paths, s.deps).removed, []);
});

test('off also removes the shortcut recorded in another Startup folder, never a file with another name', () => {
  const s = sandbox();
  enableAutostart(s.paths, { mode: 'dev' }, s.deps);
  const old = shortcutPath(s.env);
  const moved = { ...s.deps, env: { APPDATA: path.join(s.dir, 'NewRoaming') } };
  assert.deepEqual(disableAutostart(s.paths, moved).removed, [old]);

  // A tampered record pointing at some other file is ignored.
  fs.mkdirSync(s.paths.voice, { recursive: true });
  const victim = path.join(s.dir, 'important.txt');
  fs.writeFileSync(victim, 'keep me');
  fs.writeFileSync(path.join(s.paths.voice, 'autostart.json'), JSON.stringify({ file: victim }));
  disableAutostart(s.paths, s.deps);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'keep me');
});

test('non-Windows: status unsupported, on refused, off is a harmless no-op', () => {
  const s = sandbox();
  const mac = { ...s.deps, platform: 'darwin' };
  assert.equal(autostartStatus(s.paths, mac).supported, false);
  assert.throws(() => enableAutostart(s.paths, { mode: 'dev' }, mac), /só no Windows/);
  assert.deepEqual(disableAutostart(s.paths, mac).removed, []);
});

test('td uninstall turns autostart off before deleting the program files', () => {
  const src = fs.readFileSync(path.join(root, 'packages', 'cli', 'src', 'commands', 'uninstall.js'), 'utf8');
  const off = src.indexOf('disableAutostart(paths)');
  const rm = src.indexOf('removeInstall(paths');
  assert.ok(off > 0, 'uninstall calls disableAutostart');
  assert.ok(off < rm, 'before removeInstall');
});

test('real shortcut writer (Windows): .lnk created in a TEMP Startup folder, with the right target', { skip: process.platform !== 'win32' && 'Windows only' }, async () => {
  const { spawnSync } = await import('node:child_process');
  const s = sandbox();
  // Real WScript.Shell writer, but APPDATA points at the sandbox: the real Startup folder is never used.
  const r = enableAutostart(s.paths, { mode: 'dev', execPath: process.execPath }, { platform: 'win32', env: s.env });
  assert.ok(r.file.startsWith(s.dir), r.file);
  const read = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$l = (New-Object -ComObject WScript.Shell).CreateShortcut($env:TD_LNK); "$($l.TargetPath)|$($l.Arguments)|$($l.WindowStyle)"'], {
    encoding: 'utf8', windowsHide: true, env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'psmodulepath')), TD_LNK: r.file },
  });
  const [target, args, style] = read.stdout.trim().split('|');
  assert.equal(target.toLowerCase(), process.execPath.toLowerCase());
  assert.equal(args, `"${path.join(s.paths.appRoot, 'bin', 'td.js')}" voice`);
  assert.equal(style, '7');
  assert.deepEqual(disableAutostart(s.paths, { platform: 'win32', env: s.env }).removed, [r.file]);
});
