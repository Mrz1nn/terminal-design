import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isolate } from './helpers.js';
import { getPaths, readJson } from '../packages/core/src/index.js';
import * as cc from '../integrations/claude-code/index.js';
import * as wt from '../integrations/windows-terminal/index.js';

test('Claude Code install keeps other settings, backs up, and uninstall restores the previous status line', () => {
  isolate();
  const paths = getPaths();
  const file = cc.settingsFile(paths);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = { model: 'opus', statusLine: { type: 'command', command: 'bash ~/mine.sh' }, enabledPlugins: { a: true } };
  fs.writeFileSync(file, JSON.stringify(original));

  cc.install(paths);
  let s = readJson(file);
  assert.equal(s.model, 'opus');
  assert.deepEqual(s.enabledPlugins, { a: true });
  assert.ok(cc.isOurs(s.statusLine));
  assert.ok(cc.isOurs(s.subagentStatusLine));
  assert.match(s.statusLine.command, /bin\/td\.js" statusline --from=terminal-design$/);
  assert.ok(fs.readdirSync(paths.backups).some((f) => f.startsWith('claude-settings.json')));

  cc.install(paths); // reinstall must not lose the original
  cc.uninstall(paths);
  s = readJson(file);
  assert.deepEqual(s.statusLine, original.statusLine);
  assert.equal(s.subagentStatusLine, undefined);
  assert.equal(s.model, 'opus');
});

test('a broken settings.json is never overwritten', () => {
  isolate();
  const paths = getPaths();
  const file = cc.settingsFile(paths);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const broken = '{ "model": "opus", "permissions": { "allow": ["x"] }, }';
  fs.writeFileSync(file, broken);
  assert.throws(() => cc.install(paths), /nada foi alterado/);
  assert.equal(fs.readFileSync(file, 'utf8'), broken);
  assert.ok(cc.status(paths).error);
  assert.throws(() => cc.uninstall(paths), /nada foi alterado/);
});

test('reinstall remembers the newest foreign status line', () => {
  isolate();
  const paths = getPaths();
  const file = cc.settingsFile(paths);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ statusLine: { type: 'command', command: 'X' } }));
  cc.install(paths);
  const s = readJson(file);
  s.statusLine = { type: 'command', command: 'Y' }; // user switches to their own
  fs.writeFileSync(file, JSON.stringify(s));
  cc.install(paths);
  cc.uninstall(paths);
  assert.equal(readJson(file).statusLine.command, 'Y');
});

test('uninstall leaves a foreign status line alone', () => {
  isolate();
  const paths = getPaths();
  const file = cc.settingsFile(paths);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ statusLine: { type: 'command', command: 'other' } }));
  assert.equal(cc.uninstall(paths).changed, false);
  assert.equal(readJson(file).statusLine.command, 'other');
});

test('status line command: shell shim on macOS/Linux managed installs, node + launcher on Windows', () => {
  isolate();
  const paths = getPaths();
  const managed = { ...paths, appRoot: path.join(paths.versions, '0.1.1') };
  assert.match(cc.statusCommand(managed, false, 'darwin'), /^"[^"]+\/bin\/td" statusline --from=terminal-design$/);
  assert.match(cc.statusCommand(managed, true, 'linux'), /^"[^"]+\/bin\/td" statusline --subagent --from=terminal-design$/);
  assert.match(cc.statusCommand(managed, false, 'win32'), /^node "[^"]+\/launcher\.js" statusline --from=terminal-design$/);
  assert.match(cc.statusCommand(paths, false, 'darwin'), /^node "[^"]+\/bin\/td\.js" statusline/, 'dev clone uses node + td.js');
  assert.ok(cc.isOurs({ command: cc.statusCommand(managed, false, 'darwin') }));
});

test('iTerm2 preset is a valid plist with all 16 ANSI colors', async () => {
  isolate();
  const { toItermColors } = await import('../integrations/iterm2/index.js');
  const theme = (await import('../packages/themes/src/index.js')).loadTheme('nord');
  const xml = toItermColors(theme);
  assert.match(xml, /^<\?xml version="1\.0"/);
  for (let i = 0; i < 16; i++) assert.ok(xml.includes(`<key>Ansi ${i} Color</key>`), `Ansi ${i}`);
  assert.ok(xml.includes('<key>Background Color</key>'));
  // nord background #2e3440 -> red 46/255
  assert.ok(xml.includes(`<real>${(46 / 255).toFixed(6)}</real>`));
  assert.equal((xml.match(/<dict>/g) || []).length, 1 + 16 + 8);
});

test('Windows Terminal fragment contains every theme', () => {
  const root = isolate();
  const env = { LOCALAPPDATA: path.join(root, 'local') };
  const r = wt.syncSchemes(getPaths(), env);
  const frag = readJson(r.file);
  assert.equal(frag.schemes.length, 10);
  assert.ok(frag.schemes.every((s) => s.name.startsWith('TD ') && s.background && s.brightPurple));
  wt.removeSchemes(env);
  assert.equal(fs.existsSync(r.file), false);
});
