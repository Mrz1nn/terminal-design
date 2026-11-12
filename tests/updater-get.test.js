// One-line installers (scripts/get.sh, scripts/get.ps1) against LOCAL overrides only:
// a release zip built by scripts/pack-release.js, temp TD_DATA_HOME / TD_CONFIG_HOME /
// CLAUDE_CONFIG_DIR / HOME, TD_NO_PATH=1 and TD_NO_VOICE=1. No network, no real PATH.
import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SHIM_CMD, nodeCommand, privateNodePath } from '../packages/updater/src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const created = [];
after(() => { for (const d of created) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

function tmp(prefix = 'td-get-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(d);
  return d;
}

function hasShell(name) {
  const r = spawnSync(name, ['-c', 'exit 0'], { encoding: 'utf8' });
  return !r.error && r.status === 0;
}

const SH = hasShell('sh');
const WIN = process.platform === 'win32';
let dist = null;
let version = null;

before(() => {
  version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  dist = tmp('td-get-dist-');
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'pack-release.js'), `--out=${dist}`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

function sandbox() {
  const base = tmp();
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(TD_|CLAUDE_CONFIG_DIR$|PSModulePath$)/i.test(k)) delete env[k];
  Object.assign(env, {
    HOME: path.join(base, 'home'),
    TD_DATA_HOME: path.join(base, 'data'),
    TD_CONFIG_HOME: path.join(base, 'config'),
    CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
    TD_NO_PATH: '1',
    TD_NO_VOICE: '1',
    TD_NO_UPDATE_CHECK: '1',
    NO_COLOR: '1',
    TD_RELEASE_ZIP: path.join(dist, `terminal-design-${version}.zip`),
    TD_RELEASE_SUMS: path.join(dist, 'SHA256SUMS.txt'),
  });
  fs.mkdirSync(env.HOME, { recursive: true });
  fs.mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
  return { base, env };
}

const shPath = (p) => (WIN ? p.replace(/\\/g, '/') : p);

describe('scripts are well formed', () => {
  test('sh -n for get.sh, install.sh, uninstall.sh; LF endings', { skip: !SH }, () => {
    for (const f of ['get.sh', 'install.sh', 'uninstall.sh']) {
      const file = path.join(root, 'scripts', f);
      assert.equal(fs.readFileSync(file, 'utf8').includes('\r'), false, `${f} must use LF`);
      const r = spawnSync('sh', ['-n', shPath(file)], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${f}: ${r.stderr}`);
    }
  });

  test('get.sh / get.ps1 run only through a function called on the last line', () => {
    const sh = fs.readFileSync(path.join(root, 'scripts', 'get.sh'), 'utf8').trimEnd().split('\n');
    assert.equal(sh.at(-1), 'td_get_main "$@"');
    const ps = fs.readFileSync(path.join(root, 'scripts', 'get.ps1'), 'utf8');
    assert.notEqual(ps.charCodeAt(0), 0xfeff, 'no BOM: it would break `irm | iex`');
    assert.equal(ps.trimEnd().split(/\r?\n/).at(-1), 'Install-TerminalDesign @tdGetArgs');
  });

  test('get.ps1 parses in Windows PowerShell', { skip: !WIN }, () => {
    const cmd = `$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${path.join(root, 'scripts', 'get.ps1')}',[ref]$null,[ref]$e);$e.Count`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8' });
    assert.equal(r.stdout.trim(), '0', r.stdout + r.stderr);
  });
});

describe('td.cmd private node and nodeCommand()', () => {
  test('td.cmd prefers TD_NODE, then <dataHome>\\node\\node.exe, then PATH', () => {
    const lines = SHIM_CMD.split('\r\n');
    const iPriv = lines.findIndex((l) => l.includes('%~dp0..\\node\\node.exe'));
    const iEnv = lines.findIndex((l) => l.includes('if defined TD_NODE'));
    assert.ok(iPriv > 0 && iEnv > iPriv, 'TD_NODE is applied last so it wins');
    assert.ok(lines.some((l) => l.startsWith('"%TD_NODE_EXE%" "%~dp0..\\launcher.js" %*')));
  });
  test('nodeCommand returns the private node when present, else node', () => {
    const d = tmp();
    const paths = { dataHome: d };
    assert.equal(nodeCommand(paths, 'win32'), 'node');
    fs.mkdirSync(path.join(d, 'node', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(d, 'node', 'node.exe'), '');
    fs.writeFileSync(path.join(d, 'node', 'bin', 'node'), '');
    assert.equal(nodeCommand(paths, 'win32'), path.join(d, 'node', 'node.exe'));
    assert.equal(privateNodePath(paths, 'darwin'), path.join(d, 'node', 'bin', 'node'));
  });
});

describe('get.sh with local overrides', { skip: !SH }, () => {
  test('installs from the local release, Claude Code integration on, no PATH edits', () => {
    const { env } = sandbox();
    const r = spawnSync('sh', [shPath(path.join(root, 'scripts', 'get.sh'))], { encoding: 'utf8', env, timeout: 240000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /conferido \(SHA-256\)/);
    assert.match(r.stdout, /Terminal-Design instalado/);
    const curFile = path.join(env.TD_DATA_HOME, 'current.json');
    assert.ok(fs.existsSync(curFile), `current.json ausente em ${env.TD_DATA_HOME}
conteúdo: ${fs.existsSync(env.TD_DATA_HOME) ? fs.readdirSync(env.TD_DATA_HOME).join(', ') : '(pasta não existe)'}
HOME: ${JSON.stringify(fs.readdirSync(env.HOME))}
--- stdout ---
${r.stdout}
--- stderr ---
${r.stderr}`);
    const cur = JSON.parse(fs.readFileSync(curFile, 'utf8'));
    assert.equal(cur.version, version);
    assert.ok(fs.existsSync(path.join(env.CLAUDE_CONFIG_DIR, 'settings.json')), 'claude install ran');
    assert.equal(fs.existsSync(path.join(env.HOME, '.zshrc')), false, 'TD_NO_PATH respected');
  });

  test('refuses a release whose checksum does not match and installs nothing', () => {
    const { base, env } = sandbox();
    env.TD_RELEASE_SUMS = path.join(base, 'bad.txt');
    fs.writeFileSync(env.TD_RELEASE_SUMS, `${'0'.repeat(64)}  terminal-design-${version}.zip\n`);
    const r = spawnSync('sh', [shPath(path.join(root, 'scripts', 'get.sh'))], { encoding: 'utf8', env, timeout: 120000 });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /SHA-256 não confere/);
    assert.equal(fs.existsSync(path.join(env.TD_DATA_HOME, 'current.json')), false);
  });

  test('downloads a private Node.js when asked (fake dist, checksum verified)', { skip: WIN || !hasShell('tar') }, () => {
    const { base, env } = sandbox();
    const osName = process.platform === 'darwin' ? 'darwin' : 'linux';
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const name = `node-v22.99.0-${osName}-${arch}`;
    const stage = path.join(base, 'stage', name, 'bin');
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(path.join(stage, 'node'), `#!/bin/sh\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
    const nodeDist = path.join(base, 'nodedist');
    fs.mkdirSync(nodeDist);
    const tgz = path.join(nodeDist, `${name}.tar.gz`);
    assert.equal(spawnSync('tar', ['-czf', tgz, '-C', path.join(base, 'stage'), name]).status, 0);
    const hash = spawnSync(process.execPath, ['-e', `process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex'))`, tgz], { encoding: 'utf8' }).stdout;
    fs.writeFileSync(path.join(nodeDist, 'SHASUMS256.txt'), `${hash}  ${name}.tar.gz\n${'1'.repeat(64)}  ${name}.tar.xz\n`);
    Object.assign(env, { TD_NODE_DIST_URL: nodeDist, TD_FORCE_NODE_DOWNLOAD: '1', TD_NO_CLAUDE: '1' });
    const r = spawnSync('sh', [path.join(root, 'scripts', 'get.sh')], { encoding: 'utf8', env, timeout: 240000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.existsSync(path.join(env.TD_DATA_HOME, 'node', 'bin', 'node')));
    assert.match(r.stdout, /node-v22\.99\.0.*conferido/);
  });
});

describe('get.ps1 with local overrides (as `irm | iex` runs it)', { skip: !WIN }, () => {
  const run = (env) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    `Get-Content -Raw -Encoding UTF8 '${path.join(root, 'scripts', 'get.ps1')}' | Invoke-Expression; exit $LASTEXITCODE`], { encoding: 'utf8', env, timeout: 240000 });

  test('installs from the local release with Node already present', () => {
    const { env } = sandbox();
    const r = run(env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Terminal-Design instalado/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(env.TD_DATA_HOME, 'current.json'), 'utf8')).version, version);
    assert.ok(fs.existsSync(path.join(env.CLAUDE_CONFIG_DIR, 'settings.json')), 'claude install ran');
  });

  test('refuses a tampered checksum', () => {
    const { base, env } = sandbox();
    env.TD_RELEASE_SUMS = path.join(base, 'bad.txt');
    fs.writeFileSync(env.TD_RELEASE_SUMS, `${'0'.repeat(64)}  terminal-design-${version}.zip\n`);
    const r = run(env);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /SHA-256 .*download recusado/); // console codepage may mangle accents
    assert.equal(fs.existsSync(path.join(env.TD_DATA_HOME, 'current.json')), false);
  });
});
