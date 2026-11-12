// Exit codes of `td`: 0 success, 1 the command ran and failed, 2 usage error.
// Every run is isolated in a temp folder (config, data and Claude settings); nothing on the
// real machine is read or changed, and no subcommand used here touches the system.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXIT, UsageError } from '../packages/cli/src/errors.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tdJs = path.join(root, 'bin', 'td.js');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'td-exit-'));
process.on('exit', () => fs.rmSync(sandbox, { recursive: true, force: true }));

function td(...args) {
  const r = spawnSync(process.execPath, [tdJs, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      TD_DATA_HOME: path.join(sandbox, 'data'),
      TD_CONFIG_HOME: path.join(sandbox, 'config'),
      CLAUDE_CONFIG_DIR: path.join(sandbox, 'claude'),
      APPDATA: path.join(sandbox, 'appdata'),
      NO_COLOR: '1',
      TD_COLOR: '',
    },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('exit code constants', () => {
  assert.deepEqual({ ...EXIT }, { OK: 0, FAIL: 1, USAGE: 2 });
  assert.ok(new UsageError('x') instanceof Error);
});

const USAGE_CASES = [
  [['comando-que-nao-existe'], /comando desconhecido/],
  [['theme', 'xyz'], /subcomando desconhecido: td theme xyz/],
  [['config', 'xyz'], /subcomando desconhecido: td config xyz/],
  [['claude', 'xyz'], /subcomando desconhecido: td claude xyz/],
  [['voice'], /comando desconhecido: voice/],
  [['config', 'get'], /informe a chave/],
  [['config', 'set', 'cockpit.layout'], /uso: td config set/],
  [['config', 'set', 'chave.que.nao.existe', '1'], /chave desconhecida/],
  [['config', 'reset'], /informe a chave/],
  [['theme', 'set'], /informe o nome/],
  [['theme', 'import'], /informe o arquivo/],
  [['theme', 'export', 'midnight'], /uso: td theme export/],
  [['version', 'extra'], /argumento inesperado: td version extra/],
  [['doctor', 'extra'], /argumento inesperado/],
  [['update', 'agora'], /argumento inesperado/],
  [['uninstall', 'tudo'], /argumento inesperado/],
  [['help', 'xyz'], /comando desconhecido: xyz/],
];

for (const [args, message] of USAGE_CASES) {
  test(`usage error exits 2: td ${args.join(' ')}`, () => {
    const r = td(...args);
    assert.equal(r.code, 2, `stdout: ${r.out}\nstderr: ${r.err}`);
    assert.match(r.err, message);
  });
}

test('usage errors from a command point to its help', () => {
  const r = td('theme', 'xyz');
  assert.match(r.out, /td theme --help/);
});

test('success exits 0', () => {
  assert.equal(td('version').code, 0);
  assert.equal(td('help').code, 0);
  assert.equal(td('theme', '--help').code, 0);
  const h = td('help', 'theme');
  assert.equal(h.code, 0);
  assert.match(h.out, /td theme list/);
  assert.equal(td('config', 'get', 'cockpit.layout').code, 0);
});

test('a command that runs and fails exits 1, not 2', () => {
  const r = td('theme', 'set', 'tema-que-nao-existe');
  assert.equal(r.code, 1, r.err);
});

test('every unknown-subcommand path in the source uses the shared usage error', () => {
  const dir = path.join(root, 'packages', 'cli', 'src', 'commands');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /throw new Error\(`subcomando desconhecido/, f);
    assert.doesNotMatch(src, /return 2;/, `${f}: use UsageError instead of a bare 2`);
  }
});

test('td theme: numbered list without a terminal, set and preview by number', () => {
  const list = td('theme', 'list');
  assert.equal(list.code, 0);
  assert.match(list.out, /^\s+1\s+catppuccin/m);
  assert.match(list.out, /^\s+6\s+nord/m);
  const set = td('theme', 'set', '6');
  assert.equal(set.code, 0, set.err);
  assert.match(set.out, /Tema nord aplicado/);
  assert.match(td('config', 'get', 'theme.name').out, /"nord"/);
  assert.equal(td('theme', 'preview', '1').code, 0);
  const bad = td('theme', 'set', '99');
  assert.equal(bad.code, 2);
  assert.match(bad.err, /não existe tema número 99/);
  td('theme', 'set', 'midnight');
});
