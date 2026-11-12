// macOS / Linux install pieces, testable on any OS: profile PATH block with a fake HOME,
// the sh shim, and a simulated posix install. The real HOME and PATH are never touched.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getPaths } from '../packages/core/src/index.js';
import {
  addUserPath, removeUserPath, userPathHas, pathHas,
  profileTargets, profileBlock, stripProfileBlock, upsertProfileBlock, profilesWithBlock,
  PROFILE_BEGIN, PROFILE_END, renderShimSh, shimPath,
  writeLauncherFiles, launcherFilesPresent, writeCurrent, prepareVersionDir,
  installLocal, removeInstall, readCurrent,
} from '../packages/updater/src/index.js';
import { pathCheck } from '../packages/cli/src/commands/update.js';

const created = [];
after(() => { for (const d of created) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

function tmp(prefix = 'td-posix-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(d);
  return d;
}

function makePaths() {
  const root = tmp();
  process.env.TD_DATA_HOME = path.join(root, 'data');
  process.env.TD_CONFIG_HOME = path.join(root, 'config');
  const p = getPaths();
  fs.mkdirSync(p.dataHome, { recursive: true });
  return { p, home: path.join(root, 'home') };
}

function hasShell(name) {
  const r = spawnSync(name, ['-c', 'exit 0'], { encoding: 'utf8' });
  return !r.error && r.status === 0;
}

const BIN = '/Users/ana/.local/share/terminal-design/bin';

describe('profile PATH block (fake HOME)', () => {
  test('macOS: creates ~/.zshrc, also edits an existing ~/.bash_profile, backs up, never duplicates', () => {
    const home = tmp();
    const backups = path.join(home, 'backups');
    fs.writeFileSync(path.join(home, '.bash_profile'), 'export FOO=1\n');
    const r1 = addUserPath(BIN, { platform: 'darwin', home, backupDir: backups });
    assert.equal(r1.result, 'changed');
    assert.deepEqual(r1.files.map((f) => path.basename(f)).sort(), ['.bash_profile', '.zshrc']);
    assert.equal(r1.backups.length, 1, 'only the pre-existing file needs a backup');
    assert.equal(fs.readFileSync(r1.backups[0], 'utf8'), 'export FOO=1\n');
    const zshrc = fs.readFileSync(path.join(home, '.zshrc'), 'utf8');
    assert.ok(zshrc.includes(PROFILE_BEGIN) && zshrc.includes(PROFILE_END));
    assert.ok(zshrc.includes(`td_bin='${BIN}'`));
    assert.match(fs.readFileSync(path.join(home, '.bash_profile'), 'utf8'), /^export FOO=1\n\n# >>> terminal-design >>>/);

    const r2 = addUserPath(BIN, { platform: 'darwin', home, backupDir: backups });
    assert.equal(r2.result, 'unchanged');
    assert.equal(fs.readFileSync(path.join(home, '.zshrc'), 'utf8').split(PROFILE_BEGIN).length, 2, 'one block only');
    assert.equal(userPathHas(BIN, { platform: 'darwin', home }), true);
    assert.equal(profilesWithBlock({ home }).length, 2);

    const r3 = removeUserPath(BIN, { platform: 'darwin', home, backupDir: backups });
    assert.equal(r3.result, 'changed');
    assert.equal(fs.readFileSync(path.join(home, '.bash_profile'), 'utf8'), 'export FOO=1\n', 'user content restored exactly');
    assert.ok(!fs.readFileSync(path.join(home, '.zshrc'), 'utf8').includes('terminal-design'));
    assert.equal(userPathHas(BIN, { platform: 'darwin', home }), false);
    assert.equal(removeUserPath(BIN, { platform: 'darwin', home, backupDir: backups }).result, 'unchanged');
  });

  test('a changed bin folder replaces the old block instead of adding a second one', () => {
    const home = tmp();
    addUserPath('/old/bin', { platform: 'darwin', home });
    addUserPath(BIN, { platform: 'darwin', home });
    const z = fs.readFileSync(path.join(home, '.zshrc'), 'utf8');
    assert.equal(z.split(PROFILE_BEGIN).length, 2);
    assert.ok(z.includes(BIN) && !z.includes('/old/bin'));
  });

  test('Linux targets: existing ~/.bashrc and ~/.zshrc, else ~/.profile; fish when configured', () => {
    const h1 = tmp();
    fs.writeFileSync(path.join(h1, '.bashrc'), '');
    assert.deepEqual(profileTargets({ platform: 'linux', home: h1 }).map((t) => path.basename(t.file)), ['.bashrc']);
    const h2 = tmp();
    assert.deepEqual(profileTargets({ platform: 'linux', home: h2 }).map((t) => path.basename(t.file)), ['.profile']);
    fs.mkdirSync(path.join(h2, '.config', 'fish'), { recursive: true });
    const r = addUserPath(BIN, { platform: 'linux', home: h2 });
    const fish = path.join(h2, '.config', 'fish', 'conf.d', 'terminal-design.fish');
    assert.ok(r.files.includes(fish));
    assert.match(fs.readFileSync(fish, 'utf8'), /set -gx PATH/);
    removeUserPath(BIN, { platform: 'linux', home: h2 });
    assert.equal(fs.existsSync(fish), false, 'our own fish file is removed when empty');
  });

  test('pure helpers: strip leaves foreign text alone, upsert is idempotent', () => {
    const user = '# meu zshrc\nalias ll="ls -l"\n';
    const once = upsertProfileBlock(user, profileBlock(BIN));
    assert.equal(upsertProfileBlock(once, profileBlock(BIN)), once);
    assert.equal(stripProfileBlock(once), user);
    assert.equal(stripProfileBlock(user), user);
  });

  test('quotes odd folder names safely', () => {
    const block = profileBlock("/Users/o'neil/my bin");
    assert.ok(block.includes(`td_bin='/Users/o'\\''neil/my bin'`));
  });

  test('profile edits keep the file mode and follow symlinks', { skip: process.platform === 'win32' }, () => {
    const home = tmp();
    const real = path.join(home, 'dotfiles-zshrc');
    fs.writeFileSync(real, 'x=1\n', { mode: 0o600 });
    fs.symlinkSync(real, path.join(home, '.zshrc'));
    addUserPath(BIN, { platform: 'darwin', home });
    assert.ok(fs.lstatSync(path.join(home, '.zshrc')).isSymbolicLink(), 'symlink kept');
    assert.ok(fs.readFileSync(real, 'utf8').includes(PROFILE_BEGIN));
    assert.equal(fs.statSync(real).mode & 0o777, 0o600);
  });

  test('posix pathHas uses ":" and exact, case-sensitive matching', () => {
    assert.ok(pathHas(`/usr/bin:${BIN}/:/bin`, BIN, {}, 'darwin'));
    assert.equal(pathHas('/usr/bin:/bin', BIN, {}, 'darwin'), false);
    assert.equal(pathHas(BIN.toUpperCase(), BIN, {}, 'linux'), false);
  });

  test('the sh block really prepends PATH once', { skip: !hasShell('sh') }, () => {
    const home = tmp();
    const file = path.join(home, 'profile.sh');
    fs.writeFileSync(file, `${profileBlock('/opt/td bin')}\n${profileBlock('/opt/td bin')}\n`);
    const r = spawnSync('sh', ['-c', `PATH=/usr/bin:/bin; . "${file.replace(/\\/g, '/')}"; printf %s "$PATH"`], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.startsWith('/opt/td bin:'), r.stdout);
    assert.equal(r.stdout.split('/opt/td bin').length, 2);
  });
});

describe('sh shim', () => {
  test('content: recorded node, search order, exec on launcher.js', () => {
    const s = renderShimSh({ recordedNode: '/opt/node 20/bin/node' });
    assert.ok(s.startsWith('#!/bin/sh\n'));
    assert.ok(s.includes("TD_RECORDED_NODE='/opt/node 20/bin/node'"));
    const order = ['"$TD_NODE"', '"$TD_RECORDED_NODE"', 'command -v node', '/opt/homebrew/bin/node', '/usr/local/bin/node', '.volta/bin/node', '.nvm/versions/node', 'fnm'];
    let last = -1;
    for (const o of order) {
      const i = s.indexOf(o);
      assert.ok(i > last, `${o} in order`);
      last = i;
    }
    assert.ok(s.includes('exec "$td_node" "$td_launcher" "$@"'));
    assert.ok(!s.includes('\r'), 'LF only');
  });

  test('bash -n syntax check', { skip: !hasShell('bash') }, () => {
    const f = path.join(tmp(), 'td');
    fs.writeFileSync(f, renderShimSh({ recordedNode: process.execPath }));
    const r = spawnSync('bash', ['-n', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });

  test('shimPath and the files written per platform', () => {
    const { p } = makePaths();
    assert.equal(shimPath(p, 'win32'), path.join(p.binDir, 'td.cmd'));
    assert.equal(shimPath(p, 'darwin'), path.join(p.binDir, 'td'));
    const w = writeLauncherFiles(p, { platform: 'darwin', recordedNode: '/usr/local/bin/node' });
    assert.equal(w.cmd, null);
    assert.equal(fs.existsSync(path.join(p.binDir, 'td.cmd')), false);
    assert.ok(fs.readFileSync(path.join(p.binDir, 'td'), 'utf8').includes("TD_RECORDED_NODE='/usr/local/bin/node'"));
    assert.ok(launcherFilesPresent(p, 'darwin'));
    if (process.platform !== 'win32') assert.ok(fs.statSync(path.join(p.binDir, 'td')).mode & 0o111, 'executable');
  });

  test('runs without node in PATH via the recorded node, env -i style', { skip: process.platform === 'win32' || !hasShell('sh') }, () => {
    const { p, home } = makePaths();
    fs.mkdirSync(home, { recursive: true });
    prepareVersionDir(p, '0.1.0', (d) => {
      fs.mkdirSync(path.join(d, 'bin'));
      fs.writeFileSync(path.join(d, 'package.json'), '{"version":"0.1.0","type":"module"}');
      fs.writeFileSync(path.join(d, 'bin', 'td.js'), 'console.log("ran " + JSON.stringify(process.argv.slice(2)))');
    }).commit();
    writeCurrent(p, { version: '0.1.0', previous: null });
    writeLauncherFiles(p, { platform: process.platform });
    const td = path.join(p.binDir, 'td');
    const r = spawnSync('/usr/bin/env', ['-i', `HOME=${home}`, 'PATH=/usr/bin:/bin', td, 'a b', 'c'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ran \["a b","c"\]/);
    const bad = spawnSync('/usr/bin/env', ['-i', `HOME=${home}`, 'PATH=/nonexistent', 'TD_NODE=/nonexistent', '/bin/sh', '-c', `sed 's#^TD_RECORDED_NODE=.*#TD_RECORDED_NODE=#' "${td}" > "${td}.x"; /bin/sh "${td}.x"`], { encoding: 'utf8' });
    // with nothing to find it must fail clearly, unless a node lives in a standard location
    if (bad.status !== 0) assert.match(bad.stderr, /nao encontrado/);
  });
});

describe('simulated macOS install', () => {
  test('installLocal (platform darwin, fake HOME): layout, PATH block, doctor, uninstall', () => {
    const { p, home } = makePaths();
    fs.mkdirSync(home, { recursive: true });
    const src = tmp('td-posix-repo-');
    fs.mkdirSync(path.join(src, 'bin'));
    fs.writeFileSync(path.join(src, 'package.json'), '{"name":"terminal-design","version":"0.1.1"}');
    fs.writeFileSync(path.join(src, 'bin', 'td.js'), '');
    const s = installLocal({ sourceRoot: src, paths: p, platform: 'darwin', home, addPath: true });
    assert.equal(s.path, 'changed');
    assert.deepEqual(s.pathFiles, [path.join(home, '.zshrc')]);
    assert.equal(readCurrent(p).version, '0.1.1');
    assert.ok(fs.existsSync(path.join(p.binDir, 'td')));
    assert.equal(fs.existsSync(path.join(p.binDir, 'td.cmd')), false);
    assert.ok(fs.readFileSync(path.join(home, '.zshrc'), 'utf8').includes(p.binDir));

    // doctor: not in this session's PATH, but configured in the profile
    const c1 = pathCheck(p, { platform: 'darwin', env: { PATH: '/usr/bin:/bin' }, home });
    assert.equal(c1.ok, true);
    assert.match(c1.detail, /\.zshrc/);
    if (process.platform !== 'win32') { // a C:\ path cannot sit in a ':' separated PATH
      const c2 = pathCheck(p, { platform: 'darwin', env: { PATH: `/usr/bin:${p.binDir}` }, home });
      assert.match(c2.detail, /está no PATH/);
    }

    // re-run: same block, no duplicate
    const s2 = installLocal({ sourceRoot: src, paths: p, platform: 'darwin', home, addPath: true });
    assert.equal(s2.path, 'unchanged');

    // uninstall pieces: profile block (with backup) + files
    const r = removeUserPath(p.binDir, { platform: 'darwin', home, backupDir: p.backups });
    assert.equal(r.result, 'changed');
    assert.equal(r.backups.length, 1);
    assert.ok(!fs.readFileSync(path.join(home, '.zshrc'), 'utf8').includes('terminal-design'));
    const c3 = pathCheck(p, { platform: 'darwin', env: { PATH: '/usr/bin' }, home });
    assert.equal(c3.ok, null);
    removeInstall(p, { keepConfig: true, env: {} });
    assert.equal(fs.existsSync(p.binDir), false, 'bin deleted directly on posix (no deferral)');
  });
});

test('installer main-module check resolves links (macOS /var -> /private/var)', async (t) => {
  const { isMainModule } = await import('../packages/updater/src/installer.js');
  const { pathToFileURL } = await import('node:url');
  const fsm = await import('node:fs');
  const osm = await import('node:os');
  const pm = await import('node:path');
  const dir = fsm.mkdtempSync(pm.join(osm.tmpdir(), 'td-main-'));
  t.after(() => fsm.rmSync(dir, { recursive: true, force: true }));
  const real = pm.join(dir, 'real.js');
  fsm.writeFileSync(real, '');
  assert.equal(isMainModule(real, pathToFileURL(fsm.realpathSync(real)).href), true);
  const link = pm.join(dir, 'link');
  try {
    fsm.symlinkSync(dir, link, 'junction');
  } catch {
    t.skip('symlinks not allowed here');
    return;
  }
  assert.equal(isMainModule(pm.join(link, 'real.js'), pathToFileURL(fsm.realpathSync(real)).href), true, 'path through a link matches');
  assert.equal(isMainModule(pm.join(dir, 'other.js'), pathToFileURL(real).href), false);
  assert.equal(isMainModule(undefined, pathToFileURL(real).href), false);
});
