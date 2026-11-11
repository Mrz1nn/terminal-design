import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isolate } from './helpers.js';
import { compareSemver, parseSemver, deepMerge, parseJsonc, visibleWidth, stripAnsi, fg, truncate, writeJsonAtomic, readJson, backupFile } from '../packages/core/src/index.js';
import * as registry from '../packages/core/src/registry.js';

test('semver precedence follows semver 2.0', () => {
  const ordered = ['0.1.0-alpha', '0.1.0-alpha.1', '0.1.0-alpha.beta', '0.1.0-beta.2', '0.1.0-beta.11', '0.1.0-rc.1', '0.1.0', '0.1.1', '0.2.0', '1.0.0'];
  for (let i = 0; i < ordered.length - 1; i++) assert.equal(compareSemver(ordered[i], ordered[i + 1]), -1, `${ordered[i]} < ${ordered[i + 1]}`);
  assert.equal(compareSemver('v1.2.3', '1.2.3'), 0);
  assert.equal(parseSemver('nope'), null);
  assert.equal(parseSemver('01.2.3'), null);
  assert.equal(parseSemver('1.2.3-01'), null);
  assert.ok(parseSemver('1.2.3-0.rc-1+build.5'));
  assert.throws(() => compareSemver('x', '1.0.0'));
});

test('deepMerge merges objects and replaces arrays', () => {
  assert.deepEqual(deepMerge({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { c: 3 }, l: [9] }), { a: { b: 1, c: 3 }, l: [9] });
});

test('parseJsonc handles comments, trailing commas and slashes in strings', () => {
  const v = parseJsonc('{\n // c\n "url": "https://x.y/*z*/", /* b */ "a": [1,2,],\n}');
  assert.deepEqual(v, { url: 'https://x.y/*z*/', a: [1, 2] });
});

test('ansi helpers', () => {
  const s = `${fg('#ff0000', 'truecolor')}abc\x1b[0m`;
  assert.equal(stripAnsi(s), 'abc');
  assert.equal(visibleWidth(s), 3);
  assert.equal(fg('#ff0000', 'none'), '');
  assert.match(fg('#ff0000', '256'), /38;5;\d+m/);
  assert.match(fg('#ff0000', '16'), /\x1b\[\d+m/);
  assert.equal(truncate('abcdef', 4), 'abc…');
});

test('atomic write and backups', () => {
  const root = isolate();
  const f = path.join(root, 'x', 'a.json');
  writeJsonAtomic(f, { a: 1 });
  assert.deepEqual(readJson(f), { a: 1 });
  const b = backupFile(f, path.join(root, 'bk'));
  assert.ok(fs.existsSync(b));
  assert.equal(backupFile(path.join(root, 'missing.json'), path.join(root, 'bk')), null);
});

test('registry rejects duplicates', () => {
  registry._reset();
  registry.register({ id: 'a', kind: 'widget' });
  assert.throws(() => registry.register({ id: 'a', kind: 'widget' }));
  assert.equal(registry.list('widget').length, 1);
  registry._reset();
});
