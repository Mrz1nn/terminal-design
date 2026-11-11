import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolate, REAL_PAYLOAD } from './helpers.js';
import { getPaths, stripAnsi, visibleWidth } from '../packages/core/src/index.js';
import { loadConfig } from '../packages/config/src/index.js';
import { resolveTheme } from '../packages/themes/src/index.js';
import { normalize, formatTokens, formatDuration, untilEpoch } from '../apps/terminal-cockpit/src/data.js';
import { parsePorcelainV2 } from '../apps/terminal-cockpit/src/git.js';
import { renderStatusLine, renderSubagentRows } from '../apps/terminal-cockpit/src/render.js';

function setup(over = {}) {
  isolate();
  const paths = getPaths();
  const config = loadConfig(paths);
  Object.assign(config.cockpit, over);
  return { paths, config, theme: resolveTheme(config, paths) };
}

const NOW = 1794446400 * 1000 - (2 * 3600 + 10 * 60) * 1000; // 2h10m before the 5h reset

test('normalize maps the real Claude Code payload', () => {
  const d = normalize(REAL_PAYLOAD);
  assert.equal(d.model.name, 'Opus 5.5');
  assert.equal(d.effort, 'medium');
  assert.equal(d.context.usedPct, 9);
  assert.equal(d.context.usedTokens, 94173);
  assert.equal(d.context.remainingTokens, 1000000 - 94173);
  assert.equal(d.limits.fiveHour.usedPct, 36);
  assert.equal(d.limits.spend, null);
  assert.equal(d.permissionMode, null, 'not in the official payload');
  assert.equal(d.projectName, 'proj');
});

test('normalize never invents values for an empty payload', () => {
  const d = normalize({});
  assert.equal(d.context.usedPct, null);
  assert.equal(d.limits.fiveHour, null);
  assert.equal(d.limits.sevenDay, null);
  assert.equal(d.cost.estimatedUsd, null);
});

test('non-object payloads are treated as empty', () => {
  for (const v of [null, 42, 'x', []]) assert.equal(normalize(v).model.name, null);
});

test('limits are hidden once their reset time has passed', () => {
  const { config, theme, paths } = setup();
  const after = 1794967200 * 1000 + 1000; // after both resets
  const out = renderStatusLine(REAL_PAYLOAD, { config, theme, paths, git: null, now: after, colorMode: 'none', width: 200 });
  assert.doesNotMatch(out, /5h|7d/);
  const mid = 1794446400 * 1000 + 1000; // 5h reset passed, 7d not yet
  const out2 = renderStatusLine(REAL_PAYLOAD, { config, theme, paths, git: null, now: mid, colorMode: 'none', width: 200 });
  assert.doesNotMatch(out2, /5h/);
  assert.match(out2, /7d/);
});

test('formatters', () => {
  assert.equal(formatTokens(94173), '94k');
  assert.equal(formatTokens(1000000), '1M');
  assert.equal(formatTokens(1500000), '1.5M');
  assert.equal(formatDuration(626331), '10m');
  assert.equal(formatDuration(2 * 86400e3 + 3 * 3600e3), '2d3h');
  assert.equal(untilEpoch(1794446400, NOW), '2h10m');
  assert.equal(untilEpoch(null), null);
});

test('git porcelain v2 parsing', () => {
  const st = parsePorcelainV2([
    '# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1',
    '1 M. N... 100644 100644 100644 a b f1', '1 .M N... 100644 100644 100644 a b f2', '? new.txt', 'u UU N... 1 2 3 4 a b c f3',
  ].join('\n'));
  assert.deepEqual([st.branch, st.ahead, st.behind, st.staged, st.modified, st.untracked, st.conflicts, st.dirty], ['main', 2, 1, 1, 1, 1, 1, 4]);
});

test('cockpit layout renders two grouped rows with real values', () => {
  const { config, theme, paths } = setup();
  const out = renderStatusLine(REAL_PAYLOAD, { config, theme, paths, git: { branch: 'main', dirty: 0, ahead: 0, behind: 0 }, now: NOW, colorMode: 'none', width: 200 });
  const lines = out.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Opus 5\.5 medium think │ ctx .* 9% 94k\/1M │ 5h .* 36% ↻2h10m │ 7d .* 13%/);
  assert.match(lines[1], /^proj\/src │ ⎇ main ✓ │ \+91 −10 │ \$0\.97 est\. │ ⏱ 10m$/);
});

test('missing data is hidden by default and shown as n/d when asked', () => {
  const { config, theme, paths } = setup({ layout: 'full' });
  const raw = { model: { display_name: 'Sonnet' } };
  const hidden = renderStatusLine(raw, { config, theme, paths, git: null, colorMode: 'none', width: 200 });
  assert.equal(hidden, 'Sonnet');
  config.cockpit.showUnavailable = true;
  const shown = renderStatusLine(raw, { config, theme, paths, git: null, colorMode: 'none', width: 200 });
  assert.match(shown, /ctx n\/d/);
  assert.match(shown, /mensal n\/d/);
  assert.match(shown, /permissão n\/d/);
});

test('narrow width drops low-priority widgets first, keeps model and context', () => {
  const { config, theme, paths } = setup({ layout: 'compact' });
  const out = renderStatusLine(REAL_PAYLOAD, { config, theme, paths, git: { branch: 'main', dirty: 0 }, now: NOW, colorMode: 'none', width: 60 });
  assert.ok(visibleWidth(out) <= 60, out);
  assert.match(out, /Opus 5\.5/);
  assert.match(out, /ctx/);
  assert.doesNotMatch(out, /7d/);
});

test('NO_COLOR output has no escape codes; truecolor has them', () => {
  const { config, theme, paths } = setup();
  const plain = renderStatusLine(REAL_PAYLOAD, { config, theme, paths, git: null, env: { NO_COLOR: '1' }, width: 200 });
  assert.equal(plain, stripAnsi(plain));
  const color = renderStatusLine(REAL_PAYLOAD, { config, theme, paths, git: null, colorMode: 'truecolor', width: 200 });
  assert.notEqual(color, stripAnsi(color));
});

test('a throwing widget does not break the line', async () => {
  const { config, theme, paths } = setup({ layout: 'custom', rows: [['model', 'nonexistent-widget']] });
  const out = renderStatusLine(REAL_PAYLOAD, { config, theme, paths, git: null, colorMode: 'none', width: 200 });
  assert.equal(out, 'Opus 5.5 medium think');
});

test('subagent rows follow the documented {id, content} JSON-lines protocol', () => {
  const { config, theme } = setup();
  const out = renderSubagentRows({
    columns: 80,
    tasks: [
      { id: 't1', name: 'explorer', status: 'running', label: 'Lendo arquivos', startTime: NOW - 65000, tokenCount: 50000, contextWindowSize: 200000, model: 'haiku' },
      { id: 't2', agentType: 'Plan', status: 'completed', description: 'x'.repeat(300), tokenCount: 1200 },
      { status: 'running' },
    ],
  }, { config, theme, now: NOW, colorMode: 'none' });
  const rows = out.split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 't1');
  assert.match(rows[0].content, /^● explorer .* 25% haiku · 1m Lendo arquivos$/);
  assert.match(rows[1].content, /^✓ Plan/);
  assert.ok(visibleWidth(rows[1].content) <= 80);
});
