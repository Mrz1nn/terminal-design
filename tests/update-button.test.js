// Update "button": offline notice built from the cached release check, rendered in the status line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolate, REAL_PAYLOAD } from './helpers.js';
import { getPaths, writeJsonAtomic, stripAnsi } from '../packages/core/src/index.js';
import { loadConfig } from '../packages/config/src/index.js';
import { resolveTheme } from '../packages/themes/src/index.js';
import { getUpdateInfo, getUpdateNotice, cacheFile } from '../packages/updater/src/notice.js';
import { renderStatusLine } from '../apps/terminal-cockpit/src/render.js';

const pkg = { version: '0.1.0', terminalDesign: { repository: 'Mrz1nn/terminal-design' } };

function withCache(latest) {
  isolate();
  const paths = getPaths();
  const config = loadConfig(paths);
  writeJsonAtomic(cacheFile(paths), { checkedAt: Date.now(), lastAttemptAt: Date.now(), channel: 'stable', repo: 'Mrz1nn/terminal-design', latest, error: null });
  return { paths, config };
}

const base = (paths, config, extra = {}) => ({ paths, config, currentVersion: '0.1.0', mode: 'managed', background: false, pkg, ...extra });

test('newer release in cache -> button info with release URL and td update', () => {
  const { paths, config } = withCache({ version: '0.1.1', url: 'https://github.com/Mrz1nn/terminal-design/releases/tag/v0.1.1', prerelease: false });
  const info = getUpdateInfo(base(paths, config));
  assert.deepEqual(info, { version: '0.1.1', current: '0.1.0', url: 'https://github.com/Mrz1nn/terminal-design/releases/tag/v0.1.1', command: 'td update', mode: 'managed' });
  assert.match(getUpdateNotice(base(paths, config)), /0\.1\.1 disponível: rode td update/);
});

test('same or older version, update.auto off, or non-GitHub URL', () => {
  const { paths, config } = withCache({ version: '0.1.0', url: null });
  assert.equal(getUpdateInfo(base(paths, config)), null);
  const c2 = withCache({ version: '9.9.9', url: 'https://evil.example/x' });
  assert.equal(getUpdateInfo(base(c2.paths, c2.config)).url, null, 'only github.com links become clickable');
  c2.config.update.auto = 'off';
  assert.equal(getUpdateInfo(base(c2.paths, c2.config)), null);
});

test('dev install suggests git pull', () => {
  const { paths, config } = withCache({ version: '0.2.0', url: null });
  assert.equal(getUpdateInfo(base(paths, config, { mode: 'dev' })).command, 'git pull');
});

test('status line shows a clickable update button', () => {
  isolate();
  const paths = getPaths();
  const config = loadConfig(paths);
  const theme = resolveTheme(config, paths);
  const info = { version: '0.1.1', url: 'https://github.com/Mrz1nn/terminal-design/releases/tag/v0.1.1', command: 'td update' };
  const color = renderStatusLine(REAL_PAYLOAD, { config, theme, paths, git: null, updateNotice: info, colorMode: 'truecolor', width: 200 });
  assert.match(color, /\x1b\]8;;https:\/\/github\.com\/Mrz1nn\/terminal-design\/releases\/tag\/v0\.1\.1\x07/);
  const plain = renderStatusLine(REAL_PAYLOAD, { config, theme, paths, git: null, updateNotice: info, colorMode: 'none', width: 200 });
  assert.match(stripAnsi(plain), /\[ ↑ atualizar para 0\.1\.1 \] td update/);
  assert.doesNotMatch(plain, /\x1b\]8/, 'no escape codes without color');
});
