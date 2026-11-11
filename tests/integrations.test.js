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

test('uninstall leaves a foreign status line alone', () => {
  isolate();
  const paths = getPaths();
  const file = cc.settingsFile(paths);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ statusLine: { type: 'command', command: 'other' } }));
  assert.equal(cc.uninstall(paths).changed, false);
  assert.equal(readJson(file).statusLine.command, 'other');
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
