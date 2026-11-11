// Updater tests. No real network: every GitHub call goes through an injected fake fetch.
// All files live in temp folders pointed to by TD_DATA_HOME / TD_CONFIG_HOME.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getPaths } from '../packages/core/src/index.js';
import {
  parseChecksums, verifyChecksum, sha256, formatChecksums,
  selectRelease, findAssets, summarizeNotes, resolveRepo, fetchReleases,
  createZip, readZipEntries, extractZip,
  readCurrent, writeCurrent, prepareVersionDir, activate, rollback, prune, listInstalledVersions,
  writeLauncherFiles, applyUpdate, runUpdate, findPackageRoot,
  getUpdateNotice, checkForUpdates, cacheFile,
  addToPathString, removeFromPathString, pathHas,
  removeInstall, installLocal, listProgramFiles,
  readMarker, markerFile, ownsDataHome, sameDir, workerEnv,
} from '../packages/updater/src/index.js';

const PKG_META = { terminalDesign: { repository: 'Mrz1nn/terminal-design', releaseAsset: 'terminal-design-{version}.zip', checksumAsset: 'SHA256SUMS.txt' } };

const created = [];
after(async () => {
  await new Promise((r) => setTimeout(r, 300));
  for (const d of created) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});

function tmp(prefix = 'td-upd-') {
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
  fs.mkdirSync(p.configHome, { recursive: true });
  return p;
}

/** A tiny fake program: package.json + bin/td.js that prints "terminal-design <v>" for `version`. */
function writeProgram(dir, version, { tdSource } = {}) {
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'terminal-design', version, type: 'module' }));
  fs.writeFileSync(path.join(dir, 'bin', 'td.js'), tdSource ?? `
const a = process.argv.slice(2);
if (a[0] === 'version') console.log('terminal-design ${version}');
else console.log('ran ${version} ' + JSON.stringify(a));
if (a[0] === 'exit7') process.exitCode = 7;
`);
}

function installFake(paths, version, opts) {
  const h = prepareVersionDir(paths, version, (d) => writeProgram(d, version, opts));
  h.commit();
}

function release(version, { prerelease = false, draft = false, assets = true, body = '' } = {}) {
  return {
    tag_name: `v${version}`, prerelease, draft, body, html_url: `https://github.com/x/y/releases/tag/v${version}`,
    assets: assets ? [
      { name: `terminal-design-${version}.zip`, browser_download_url: `https://example.test/terminal-design-${version}.zip` },
      { name: 'SHA256SUMS.txt', browser_download_url: `https://example.test/${version}/SHA256SUMS.txt` },
    ] : [],
  };
}

function buildReleaseZip(version, opts = {}) {
  const src = tmp('td-src-');
  writeProgram(src, opts.pkgVersion ?? version, opts);
  const entries = [];
  const walk = (d, rel) => {
    for (const n of fs.readdirSync(d)) {
      const f = path.join(d, n);
      if (fs.statSync(f).isDirectory()) walk(f, `${rel}${n}/`);
      else entries.push({ name: `terminal-design-${version}/${rel}${n}`, data: fs.readFileSync(f) });
    }
  };
  walk(src, '');
  const zip = path.join(tmp('td-zip-'), `terminal-design-${version}.zip`);
  createZip(entries, zip);
  return fs.readFileSync(zip);
}

/** Fake fetch serving a releases list plus asset bodies keyed by URL. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const r = routes[url] ?? (url.includes('/releases?') ? routes.releases : undefined);
    if (r === undefined) return { status: 404, headers: {}, body: Buffer.from('{"message":"Not Found"}') };
    if (typeof r === 'function') return r(url, opts);
    if (r && r.status) return r;
    return { status: 200, headers: {}, body: Buffer.isBuffer(r) ? r : Buffer.from(typeof r === 'string' ? r : JSON.stringify(r)) };
  };
  fn.calls = calls;
  return fn;
}

function stubUi() {
  const lines = [];
  const rec = (k) => (s) => lines.push(`${k}: ${s}`);
  const id = (s) => String(s);
  return {
    lines,
    c: { primary: id, secondary: id, accent: id, success: id, warning: id, error: id, muted: id, fg: id, bold: id, dim: id },
    print: rec('print'), title: rec('title'), info: rec('info'), ok: rec('ok'), warn: rec('warn'), error: rec('error'),
    table: (rows) => rows.forEach(([k, v]) => lines.push(`table: ${k} = ${v}`)),
    confirm: async () => true,
  };
}

describe('checksums', () => {
  const h = 'a'.repeat(64);
  test('parses sha256sum text and binary markers, comments, CRLF and BOM', () => {
    const m = parseChecksums(`\uFEFF# comment\r\n${h}  terminal-design-1.0.0.zip\r\n${'B'.repeat(64)} *other.txt\n\n`);
    assert.equal(m.get('terminal-design-1.0.0.zip'), h);
    assert.equal(m.get('other.txt'), 'b'.repeat(64));
  });
  test('rejects malformed lines and conflicting duplicates', () => {
    assert.throws(() => parseChecksums('nothex  file.zip'));
    assert.throws(() => parseChecksums(`${h}  f\n${'c'.repeat(64)}  f`));
  });
  test('verify accepts matching data, refuses mismatch and missing entries', () => {
    const data = Buffer.from('hello');
    const sums = formatChecksums([{ name: 'f.zip', hash: sha256(data) }]);
    assert.equal(verifyChecksum(data, 'f.zip', sums), sha256(data));
    assert.throws(() => verifyChecksum(Buffer.from('tampered'), 'f.zip', sums), /não confere/);
    assert.throws(() => verifyChecksum(data, 'g.zip', sums), /não tem entrada/);
  });
});

describe('release selection', () => {
  const list = [
    release('0.3.0-beta.1', { prerelease: true }),
    release('0.2.0'),
    release('0.4.0', { draft: true }),
    { tag_name: 'nightly', assets: [] },
    release('0.2.1-rc.1'), // semver prerelease even without the GitHub flag
    release('0.1.0'),
  ];
  test('stable ignores drafts, prereleases and non-semver tags', () => {
    assert.equal(selectRelease(list, 'stable').version, '0.2.0');
  });
  test('prerelease channel includes prereleases', () => {
    assert.equal(selectRelease(list, 'prerelease').version, '0.3.0-beta.1');
  });
  test('empty list gives null', () => {
    assert.equal(selectRelease([], 'stable'), null);
  });
  test('asset lookup, repo resolution and notes summary', () => {
    const a = findAssets(release('1.0.0'), '1.0.0', PKG_META.terminalDesign);
    assert.equal(a.zip.name, 'terminal-design-1.0.0.zip');
    assert.equal(a.sums.name, 'SHA256SUMS.txt');
    assert.equal(findAssets(release('1.0.0', { assets: false }), '1.0.0').zip, null);
    assert.equal(resolveRepo({ update: { repository: null } }, PKG_META), 'Mrz1nn/terminal-design');
    assert.equal(resolveRepo({ update: { repository: 'a/b' } }, PKG_META), 'a/b');
    assert.throws(() => resolveRepo({ update: { repository: 'bad repo' } }, PKG_META));
    const notes = summarizeNotes('## Novidades\n\n- **um**\n- `dois`\n<!-- x -->\n' + '- linha\n'.repeat(10), 3);
    assert.deepEqual(notes.slice(0, 3), ['Novidades', '- um', '- dois']);
    assert.match(notes[3], /\+10 linhas/);
  });
  test('fetchReleases: 404 is a friendly not-found error, rate limit detected, sends UA-free headers only', async () => {
    await assert.rejects(fetchReleases('Mrz1nn/terminal-design', { fetch: fakeFetch({}) }), (e) => e.code === 'not-found');
    const rl = fakeFetch({ releases: { status: 403, headers: { 'x-ratelimit-remaining': '0' }, body: Buffer.from('{}') } });
    await assert.rejects(fetchReleases('a/b', { fetch: rl }), (e) => e.code === 'rate-limit');
    const f = fakeFetch({ releases: [release('1.0.0')] });
    const list2 = await fetchReleases('a/b', { fetch: f, env: { GITHUB_TOKEN: 't0k' } });
    assert.equal(list2.length, 1);
    assert.match(f.calls[0].url, /^https:\/\/api\.github\.com\/repos\/a\/b\/releases/);
    assert.equal(f.calls[0].opts.headers.Authorization, 'Bearer t0k');
  });
});

describe('zip', () => {
  test('round trip through the Node reader and tar.exe', () => {
    const zip = path.join(tmp(), 'a.zip');
    const big = Buffer.from('x'.repeat(10000));
    createZip([{ name: 'r/a.txt', data: Buffer.from('olá') }, { name: 'r/sub/b.bin', data: big }, { name: 'r/empty', data: Buffer.alloc(0) }], zip);
    assert.equal(readZipEntries(fs.readFileSync(zip)).length, 3);
    for (const useTar of [false, true]) {
      const out = tmp();
      extractZip(zip, out, { useTar });
      assert.equal(fs.readFileSync(path.join(out, 'r', 'a.txt'), 'utf8'), 'olá');
      assert.deepEqual(fs.readFileSync(path.join(out, 'r', 'sub', 'b.bin')), big);
      assert.throws(() => findPackageRoot(out), /package.json/);
    }
  });
  test('refuses entries that escape the folder (zip slip)', () => {
    const zip = path.join(tmp(), 'evil.zip');
    createZip([{ name: 'aa/evil.txt', data: Buffer.from('x') }], zip);
    const buf = fs.readFileSync(zip);
    // rewrite both copies of the name to "../evil.txt"
    let s = buf.toString('latin1').split('aa/evil.txt').join('../evil.txt');
    fs.writeFileSync(zip, Buffer.from(s, 'latin1'));
    const out = tmp();
    assert.throws(() => extractZip(zip, out), /\.\./);
    assert.equal(fs.existsSync(path.join(out, '..', 'evil.txt')), false);
  });
});

describe('versions: switch, rollback, prune', () => {
  test('activate records previous, rollback swaps, reinstall keeps previous', () => {
    const p = makePaths();
    installFake(p, '0.1.0');
    installFake(p, '0.2.0');
    activate(p, '0.1.0');
    assert.deepEqual([readCurrent(p).version, readCurrent(p).previous], ['0.1.0', null]);
    activate(p, '0.2.0');
    assert.deepEqual([readCurrent(p).version, readCurrent(p).previous], ['0.2.0', '0.1.0']);
    activate(p, '0.2.0'); // same version again (re-run of the installer)
    assert.deepEqual([readCurrent(p).version, readCurrent(p).previous], ['0.2.0', '0.1.0']);
    rollback(p);
    assert.deepEqual([readCurrent(p).version, readCurrent(p).previous], ['0.1.0', '0.2.0']);
    assert.throws(() => activate(p, '9.9.9'), /não está instalada/);
  });
  test('rollback refuses when previous is missing', () => {
    const p = makePaths();
    installFake(p, '0.1.0');
    activate(p, '0.1.0');
    assert.throws(() => rollback(p), /não há versão anterior/);
    writeCurrent(p, { version: '0.1.0', previous: '0.0.9' });
    assert.throws(() => rollback(p), /não está mais instalada/);
  });
  test('prune keeps only current and previous', () => {
    const p = makePaths();
    for (const v of ['0.1.0', '0.2.0', '0.3.0', '0.4.0-beta.1']) installFake(p, v);
    writeCurrent(p, { version: '0.3.0', previous: '0.2.0' });
    fs.mkdirSync(path.join(p.versions, 'not-a-version'));
    const removed = prune(p);
    assert.deepEqual(removed.sort(), ['0.1.0', '0.4.0-beta.1']);
    assert.deepEqual(listInstalledVersions(p), ['0.3.0', '0.2.0']);
    assert.ok(fs.existsSync(path.join(p.versions, 'not-a-version')), 'unknown folders are left alone');
  });
  test('prune without current.json deletes nothing', () => {
    const p = makePaths();
    installFake(p, '0.1.0');
    assert.deepEqual(prune(p), []);
  });
  test('prepareVersionDir revert restores the old folder', () => {
    const p = makePaths();
    installFake(p, '0.1.0');
    fs.writeFileSync(path.join(p.versions, '0.1.0', 'marker'), 'old');
    const h = prepareVersionDir(p, '0.1.0', (d) => writeProgram(d, '0.1.0'));
    assert.equal(fs.existsSync(path.join(p.versions, '0.1.0', 'marker')), false);
    h.revert();
    assert.equal(fs.readFileSync(path.join(p.versions, '0.1.0', 'marker'), 'utf8'), 'old');
  });
});

describe('launcher', () => {
  test('runs current, passes argv and exit code through', () => {
    const p = makePaths();
    installFake(p, '0.2.0');
    writeLauncherFiles(p);
    writeCurrent(p, { version: '0.2.0', previous: null });
    const r = spawnSync(process.execPath, [p.launcher, 'a b', '--x=1'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /ran 0\.2\.0 \["a b","--x=1"\]/);
    assert.equal(r.stderr, '');
    const r7 = spawnSync(process.execPath, [p.launcher, 'exit7'], { encoding: 'utf8' });
    assert.equal(r7.status, 7);
  });
  test('falls back to previous with a warning when current is broken', () => {
    const p = makePaths();
    installFake(p, '0.1.0');
    installFake(p, '0.2.0', { tdSource: 'this is not javascript (' });
    writeLauncherFiles(p);
    writeCurrent(p, { version: '0.2.0', previous: '0.1.0' });
    const r = spawnSync(process.execPath, [p.launcher, 'hi'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /ran 0\.1\.0 \["hi"\]/);
    assert.match(r.stderr, /anterior 0\.1\.0/);
  });
  test('falls back when the current folder is missing; fails clearly when nothing works', () => {
    const p = makePaths();
    installFake(p, '0.1.0');
    writeLauncherFiles(p);
    writeCurrent(p, { version: '0.9.0', previous: '0.1.0' });
    assert.match(spawnSync(process.execPath, [p.launcher], { encoding: 'utf8' }).stdout, /ran 0\.1\.0/);
    fs.rmSync(p.currentFile);
    const r = spawnSync(process.execPath, [p.launcher], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Reinstale/);
  });
  test('rejects path tricks in current.json', () => {
    const p = makePaths();
    writeLauncherFiles(p);
    fs.writeFileSync(p.currentFile, JSON.stringify({ version: '..\\..\\evil', previous: null }));
    assert.equal(spawnSync(process.execPath, [p.launcher], { encoding: 'utf8' }).status, 1);
  });
  test('td.cmd shim forwards arguments and exit code', { skip: process.platform !== 'win32' }, () => {
    const p = makePaths();
    installFake(p, '0.2.0');
    writeLauncherFiles(p);
    writeCurrent(p, { version: '0.2.0', previous: null });
    const cmd = path.join(p.binDir, 'td.cmd');
    const r = spawnSync('cmd.exe', ['/d', '/c', `"${cmd}" exit7 foo`], { encoding: 'utf8', windowsVerbatimArguments: true });
    assert.match(r.stdout, /ran 0\.2\.0 \["exit7","foo"\]/);
    assert.equal(r.status, 7);
  });
});

describe('applyUpdate', () => {
  function setup({ zipOpts = {}, sumsOverride } = {}) {
    const p = makePaths();
    installFake(p, '0.1.0');
    writeLauncherFiles(p);
    activate(p, '0.1.0');
    const cfg = '{\n  "theme": { "name": "nord" }, "mine": true\n}\n';
    fs.writeFileSync(p.configFile, cfg);
    const zip = buildReleaseZip('0.2.0', zipOpts);
    const sums = sumsOverride ?? formatChecksums([{ name: 'terminal-design-0.2.0.zip', hash: sha256(zip) }]);
    const fetch = fakeFetch({
      'https://example.test/terminal-design-0.2.0.zip': zip,
      'https://example.test/0.2.0/SHA256SUMS.txt': sums,
    });
    return { p, cfg, fetch, best: { version: '0.2.0', release: release('0.2.0') } };
  }

  test('installs, switches, keeps previous, backs up and never modifies config', async () => {
    const { p, cfg, fetch, best } = setup();
    const r = await applyUpdate({ paths: p, best, pkg: PKG_META, currentVersion: '0.1.0', fetch });
    assert.equal(r.version, '0.2.0');
    assert.deepEqual([readCurrent(p).version, readCurrent(p).previous], ['0.2.0', '0.1.0']);
    assert.equal(fs.readFileSync(p.configFile, 'utf8'), cfg, 'config untouched');
    assert.ok(fs.readdirSync(p.backups).some((f) => f.startsWith('config.json.')));
    assert.ok(fs.existsSync(path.join(p.versions, '0.2.0', 'bin', 'td.js')));
    assert.deepEqual(fs.readdirSync(p.staging).filter((n) => !n.endsWith('.lock')), [], 'staging cleaned');
    assert.match(spawnSync(process.execPath, [p.launcher, 'x'], { encoding: 'utf8' }).stdout, /ran 0\.2\.0/);
  });

  test('refuses on checksum mismatch and leaves everything as it was', async () => {
    const { p, cfg, fetch, best } = setup({ sumsOverride: `${'0'.repeat(64)}  terminal-design-0.2.0.zip\n` });
    await assert.rejects(applyUpdate({ paths: p, best, pkg: PKG_META, currentVersion: '0.1.0', fetch }), /não confere/);
    assert.equal(readCurrent(p).version, '0.1.0');
    assert.equal(fs.existsSync(path.join(p.versions, '0.2.0')), false);
    assert.equal(fs.readFileSync(p.configFile, 'utf8'), cfg);
  });

  test('refuses when the checksum file or its entry is missing', async () => {
    const a = setup();
    const noSums = { ...a.best, release: { ...a.best.release, assets: a.best.release.assets.slice(0, 1) } };
    await assert.rejects(applyUpdate({ paths: a.p, best: noSums, pkg: PKG_META, currentVersion: '0.1.0', fetch: a.fetch }), /sem checksum/);
    const b = setup({ sumsOverride: `${'0'.repeat(64)}  other.zip\n` });
    await assert.rejects(applyUpdate({ paths: b.p, best: b.best, pkg: PKG_META, currentVersion: '0.1.0', fetch: b.fetch }), /não tem entrada/);
    assert.equal(readCurrent(b.p).version, '0.1.0');
  });

  test('rejects a package whose version does not match the tag', async () => {
    const { p, fetch, best } = setup({ zipOpts: { pkgVersion: '0.3.0' } });
    await assert.rejects(applyUpdate({ paths: p, best, pkg: PKG_META, currentVersion: '0.1.0', fetch }), /não confere com a release/);
    assert.equal(readCurrent(p).version, '0.1.0');
  });

  test('a failing smoke test aborts before anything is switched', async () => {
    const { p, fetch, best } = setup({ zipOpts: { tdSource: 'process.exit(3)' } });
    await assert.rejects(applyUpdate({ paths: p, best, pkg: PKG_META, currentVersion: '0.1.0', fetch }), /teste da nova versão falhou/);
    assert.equal(readCurrent(p).version, '0.1.0');
    assert.equal(fs.existsSync(path.join(p.versions, '0.2.0')), false);
  });

  test('failure after the switch rolls current.json back', async () => {
    const { p, fetch, best } = setup();
    // after the switch, launcher files are missing and bin cannot be written -> must roll back
    let calls = 0;
    const smoke = () => {
      calls++;
      fs.rmSync(p.launcher);
      fs.rmSync(p.binDir, { recursive: true });
      fs.writeFileSync(p.binDir, 'x');
    };
    const r = applyUpdate({ paths: p, best, pkg: PKG_META, currentVersion: '0.1.0', fetch, smoke });
    await assert.rejects(r, /desfeito/);
    assert.equal(calls, 1);
    assert.equal(readCurrent(p).version, '0.1.0');
    assert.equal(fs.existsSync(path.join(p.versions, '0.2.0')), false);
  });

  test('a second update while one is running is refused (lock)', async () => {
    const { p, fetch, best } = setup();
    fs.mkdirSync(p.staging, { recursive: true });
    fs.writeFileSync(path.join(p.staging, 'update.lock'), '{}');
    await assert.rejects(applyUpdate({ paths: p, best, pkg: PKG_META, currentVersion: '0.1.0', fetch }), /em andamento/);
  });
});

describe('runUpdate (command flow)', () => {
  function ctxFor(p, mode, version = '0.1.0') {
    return { paths: p, config: { update: { auto: 'notify', channel: 'stable', repository: null, checkIntervalHours: 24 } }, ui: stubUi(), version, mode };
  }
  test('404 (repo not published yet) is reported gracefully', async () => {
    const p = makePaths();
    const ctx = ctxFor(p, 'managed');
    assert.equal(await runUpdate({ ctx, flags: {}, fetch: fakeFetch({}), pkg: PKG_META }), 0);
    assert.ok(ctx.ui.lines.some((l) => /não encontrado/.test(l)));
  });
  test('dev mode shows the available version and suggests git pull', async () => {
    const p = makePaths();
    const ctx = ctxFor(p, 'dev');
    assert.equal(await runUpdate({ ctx, flags: {}, fetch: fakeFetch({ releases: [release('0.2.0', { body: '- coisa nova' })] }), pkg: PKG_META }), 0);
    assert.ok(ctx.ui.lines.some((l) => /disponível = 0\.2\.0/.test(l)));
    assert.ok(ctx.ui.lines.some((l) => /git pull/.test(l)));
    assert.ok(ctx.ui.lines.some((l) => /coisa nova/.test(l)));
  });
  test('--check never downloads; up-to-date is reported', async () => {
    const p = makePaths();
    const f = fakeFetch({ releases: [release('0.2.0')] });
    const ctx = ctxFor(p, 'managed');
    assert.equal(await runUpdate({ ctx, flags: { check: true }, fetch: f, pkg: PKG_META }), 0);
    assert.equal(f.calls.length, 1);
    const ctx2 = ctxFor(p, 'managed', '0.2.0');
    await runUpdate({ ctx: ctx2, flags: {}, fetch: f, pkg: PKG_META });
    assert.ok(ctx2.ui.lines.some((l) => /mais recente/.test(l)));
  });
  test('--rollback switches back to previous', async () => {
    const p = makePaths();
    installFake(p, '0.1.0');
    installFake(p, '0.2.0');
    writeCurrent(p, { version: '0.2.0', previous: '0.1.0' });
    const ctx = ctxFor(p, 'managed', '0.2.0');
    assert.equal(await runUpdate({ ctx, flags: { rollback: true, yes: true }, pkg: PKG_META }), 0);
    assert.equal(readCurrent(p).version, '0.1.0');
  });
});

describe('update notice (cached, offline)', () => {
  const cfg = (auto = 'notify') => ({ update: { auto, channel: 'stable', repository: null, checkIntervalHours: 24 } });
  test('fresh cache with newer version gives a notice without network', () => {
    const p = makePaths();
    fs.mkdirSync(p.cache, { recursive: true });
    const now = Date.now();
    fs.writeFileSync(cacheFile(p), JSON.stringify({ checkedAt: now - 1000, channel: 'stable', repo: 'Mrz1nn/terminal-design', latest: { version: '0.5.0' } }));
    const n = getUpdateNotice({ paths: p, config: cfg(), currentVersion: '0.1.0', mode: 'managed', now, background: false, pkg: PKG_META, env: {} });
    assert.match(n, /0\.5\.0.*td update/);
    assert.equal(getUpdateNotice({ paths: p, config: cfg(), currentVersion: '0.5.0', now, background: false, pkg: PKG_META, env: {} }), null);
    assert.equal(getUpdateNotice({ paths: p, config: cfg('off'), currentVersion: '0.1.0', now, background: false, pkg: PKG_META, env: {} }), null);
    assert.match(getUpdateNotice({ paths: p, config: cfg(), currentVersion: '0.1.0', mode: 'dev', now, background: false, pkg: PKG_META, env: {} }), /git pull/);
  });
  test('no cache gives null', () => {
    const p = makePaths();
    assert.equal(getUpdateNotice({ paths: p, config: cfg(), currentVersion: '0.1.0', background: false, pkg: PKG_META, env: {} }), null);
  });
  test('checkForUpdates writes the cache, including errors', async () => {
    const p = makePaths();
    const ok = await checkForUpdates({ paths: p, config: cfg(), pkg: PKG_META, fetch: fakeFetch({ releases: [release('0.3.0')] }) });
    assert.equal(ok.latest.version, '0.3.0');
    assert.equal(JSON.parse(fs.readFileSync(cacheFile(p), 'utf8')).latest.version, '0.3.0');
    const bad = await checkForUpdates({ paths: p, config: cfg(), pkg: PKG_META, fetch: fakeFetch({}) });
    assert.equal(bad.error.code, 'not-found');
  });
});

describe('PATH helpers (pure, the real PATH is never touched)', () => {
  const env = { USERPROFILE: 'C:\\Users\\x' };
  test('add is idempotent and case/trailing-slash insensitive', () => {
    const base = 'C:\\a;%USERPROFILE%\\bin';
    const added = addToPathString(base, 'C:\\TD\\bin', env);
    assert.equal(added, 'C:\\a;%USERPROFILE%\\bin;C:\\TD\\bin');
    assert.equal(addToPathString(added, 'c:\\td\\BIN\\', env), added);
    assert.equal(addToPathString(base, 'C:\\Users\\x\\bin', env), base);
    assert.ok(pathHas(added, 'C:\\td\\bin', env));
  });
  test('remove drops only matching entries', () => {
    assert.equal(removeFromPathString('C:\\a;C:\\TD\\bin\\;;C:\\b', 'c:\\td\\bin', env), 'C:\\a;C:\\b');
  });
});

describe('uninstall and local install', () => {
  test('removeInstall keeps config by default and only deletes our own items', () => {
    const p = makePaths();
    installFake(p, '0.1.0');
    writeLauncherFiles(p);
    activate(p, '0.1.0');
    fs.writeFileSync(p.configFile, '{}');
    fs.mkdirSync(p.backups, { recursive: true });
    fs.writeFileSync(path.join(p.dataHome, 'user-file.txt'), 'not ours');
    const r = removeInstall(p, { keepConfig: true });
    assert.ok(r.removed.length > 0);
    assert.equal(fs.existsSync(p.versions), false);
    assert.equal(fs.existsSync(p.launcher), false);
    assert.ok(fs.existsSync(p.configFile));
    assert.ok(fs.existsSync(p.backups));
    assert.ok(fs.existsSync(path.join(p.dataHome, 'user-file.txt')));
    removeInstall(p, { keepConfig: false });
    assert.equal(fs.existsSync(p.configFile), false);
    assert.equal(fs.existsSync(p.backups), false);
    assert.equal(fs.existsSync(p.configHome), false, 'empty config folder removed');
  });

  test('installLocal builds the layout, is idempotent and never overwrites config', () => {
    const p = makePaths();
    const src = tmp('td-repo-');
    writeProgram(src, '0.1.0');
    fs.mkdirSync(path.join(src, 'tests'));
    fs.writeFileSync(path.join(src, 'tests', 'x.test.js'), '');
    fs.mkdirSync(path.join(src, '.git'));
    fs.mkdirSync(path.join(src, 'themes'));
    fs.writeFileSync(path.join(src, 'themes', 'nord.json'), '{}');
    assert.deepEqual(listProgramFiles(src), ['bin/td.js', 'package.json', 'themes/nord.json']);

    const s1 = installLocal({ sourceRoot: src, paths: p, addPath: false });
    assert.equal(s1.configCreated, true);
    assert.equal(s1.path, 'skipped');
    for (const f of [p.launcher, p.currentFile, path.join(p.binDir, 'td.cmd'), path.join(p.binDir, 'td'), path.join(p.versions, '0.1.0', 'bin', 'td.js')]) {
      assert.ok(fs.existsSync(f), f);
    }
    assert.equal(fs.existsSync(path.join(p.versions, '0.1.0', 'tests')), false);
    fs.writeFileSync(p.configFile, '{"mine":1}');
    const s2 = installLocal({ sourceRoot: src, paths: p, addPath: false, theme: 'nope' });
    assert.equal(s2.reinstall, true);
    assert.equal(s2.configCreated, false);
    assert.ok(s2.themeError);
    assert.equal(fs.readFileSync(p.configFile, 'utf8'), '{"mine":1}');
    assert.deepEqual(readCurrent(p), { ...readCurrent(p), version: '0.1.0', previous: null });
    installLocal({ sourceRoot: src, paths: p, addPath: false, theme: 'nord' });
    assert.equal(JSON.parse(fs.readFileSync(p.configFile, 'utf8')).theme.name, 'nord');
    assert.equal(JSON.parse(fs.readFileSync(p.configFile, 'utf8')).mine, 1);
  });
});

test('removeInstall deferBin deletes bin after a delay (td.cmd may still be running)', async () => {
  const p = makePaths();
  writeLauncherFiles(p);
  const r = removeInstall(p, { keepConfig: true, deferBin: true });
  assert.deepEqual(r.deferred, [p.binDir]);
  assert.ok(fs.existsSync(path.join(p.binDir, 'td.cmd')), 'still there right after');
  for (let i = 0; i < 40 && fs.existsSync(p.binDir); i++) await new Promise((res) => setTimeout(res, 250));
  assert.equal(fs.existsSync(p.binDir), false);
});

describe('QA fixes', () => {
  test('uninstall refuses a TD_DATA_HOME folder that is not ours and deletes nothing', () => {
    const p = makePaths();
    for (const n of ['versions', 'bin', 'cache', 'logs', 'voice']) fs.mkdirSync(path.join(p.dataHome, n));
    fs.writeFileSync(path.join(p.dataHome, 'package.json'), '{"name":"someone-elses-project"}');
    assert.equal(ownsDataHome(p, {}), false);
    assert.throws(() => removeInstall(p, { keepConfig: false, env: {} }), /não parece ser uma instalação/);
    for (const n of ['versions', 'bin', 'cache', 'logs', 'voice', 'package.json']) assert.ok(fs.existsSync(path.join(p.dataHome, n)), n);
  });

  test('ownership: marker, legacy launcher + current.json, or the default location (case-insensitive)', () => {
    const p = makePaths();
    installFake(p, '0.1.0');
    writeLauncherFiles(p);
    assert.ok(readMarker(p));
    assert.ok(ownsDataHome(p, {}));
    activate(p, '0.1.0');
    fs.rmSync(markerFile(p));
    assert.ok(ownsDataHome(p, {}), 'legacy: our launcher header + valid current.json');
    fs.rmSync(p.currentFile);
    assert.equal(ownsDataHome(p, {}), false);
    const parent = path.dirname(p.dataHome);
    const env = { LOCALAPPDATA: process.platform === 'win32' ? parent.toUpperCase() : parent };
    if (process.platform === 'win32') {
      assert.ok(sameDir('C:\\Foo\\Bar\\', 'c:\\foo\\bar'));
      // dataHome = <parent>\data, so make the default point at it
      assert.equal(ownsDataHome({ ...p, dataHome: path.join(parent, 'terminaldesign') }, env), true);
    }
  });

  test('purge leaves a custom config folder alone unless the installer recorded it', () => {
    const p = makePaths();
    installFake(p, '0.1.0');
    writeLauncherFiles(p, { configHome: null }); // marker without the custom config home
    activate(p, '0.1.0');
    fs.writeFileSync(p.configFile, '{}');
    fs.mkdirSync(p.userThemes, { recursive: true });
    const r = removeInstall(p, { keepConfig: false, env: {} });
    assert.ok(fs.existsSync(p.configFile));
    assert.ok(fs.existsSync(p.userThemes));
    assert.ok(r.kept.some((k) => /personalizada/.test(k)));
  });

  test('launcher pins TD_CONFIG_HOME recorded at install time, and never overrides an explicit one', () => {
    const p = makePaths();
    installFake(p, '0.1.0', { tdSource: 'console.log("CFG=" + process.env.TD_CONFIG_HOME + " DATA=" + process.env.TD_DATA_HOME)' });
    writeLauncherFiles(p); // TD_CONFIG_HOME is set by makePaths -> recorded
    writeCurrent(p, { version: '0.1.0', previous: null });
    assert.equal(readMarker(p).configHome, p.configHome);
    const env = { ...process.env };
    delete env.TD_CONFIG_HOME;
    delete env.TD_DATA_HOME;
    const out = spawnSync(process.execPath, [p.launcher], { encoding: 'utf8', env }).stdout;
    assert.ok(out.includes(`CFG=${p.configHome}`), out);
    assert.ok(out.includes(`DATA=${p.dataHome}`), out);
    const explicit = path.join(os.tmpdir(), 'explicit-cfg');
    const out2 = spawnSync(process.execPath, [p.launcher], { encoding: 'utf8', env: { ...env, TD_CONFIG_HOME: explicit } }).stdout;
    assert.ok(out2.includes(`CFG=${explicit}`), out2);
  });

  test('default config home is not recorded in the marker', () => {
    const p = makePaths();
    const saved = process.env.TD_CONFIG_HOME;
    delete process.env.TD_CONFIG_HOME;
    try {
      writeLauncherFiles(p);
      assert.equal(readMarker(p).configHome, null);
    } finally {
      process.env.TD_CONFIG_HOME = saved;
    }
  });

  test('a prune failure after the switch keeps the new version and only warns', async () => {
    const p = makePaths();
    installFake(p, '0.1.0');
    writeLauncherFiles(p);
    activate(p, '0.1.0');
    const zip = buildReleaseZip('0.2.0');
    const fetch = fakeFetch({
      'https://example.test/terminal-design-0.2.0.zip': zip,
      'https://example.test/0.2.0/SHA256SUMS.txt': formatChecksums([{ name: 'terminal-design-0.2.0.zip', hash: sha256(zip) }]),
    });
    const r = await applyUpdate({
      paths: p, best: { version: '0.2.0', release: release('0.2.0') }, pkg: PKG_META, currentVersion: '0.1.0', fetch,
      pruneFn: () => { const e = new Error('busy'); e.code = 'EBUSY'; throw e; },
    });
    assert.equal(r.version, '0.2.0');
    assert.match(r.warnings[0], /EBUSY/);
    assert.equal(readCurrent(p).version, '0.2.0');
    assert.ok(fs.existsSync(path.join(p.versions, '0.2.0', 'bin', 'td.js')));
  });

  test('installer: failures after activation are warnings, the install stays active', () => {
    const p = makePaths();
    const src = tmp('td-repo-');
    writeProgram(src, '0.1.0');
    const boom = (code) => () => { const e = new Error(code); e.code = code; throw e; };
    const s = installLocal({
      sourceRoot: src, paths: p, addPath: true,
      deps: { ensureConfig: boom('EACCES'), prune: boom('EBUSY'), addUserPath: boom('EPERM') },
    });
    assert.equal(readCurrent(p).version, '0.1.0');
    assert.ok(fs.existsSync(path.join(p.versions, '0.1.0', 'bin', 'td.js')));
    assert.equal(s.warnings.length, 3);
    assert.equal(s.path, 'error');
  });

  test('background check environment never carries GitHub tokens', () => {
    const p = makePaths();
    const env = workerEnv(p, { PATH: 'x', GITHUB_TOKEN: 'a', GH_TOKEN: 'b', github_token: 'c', TD_COLOR: 'none' });
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.GH_TOKEN, undefined);
    assert.equal(env.github_token, undefined);
    assert.equal(env.PATH, 'x');
    assert.equal(env.TD_DATA_HOME, p.dataHome);
    assert.equal(env.TD_CONFIG_HOME, p.configHome);
  });
});
