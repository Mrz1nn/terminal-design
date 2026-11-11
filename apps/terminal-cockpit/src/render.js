import { registry, visibleWidth, detectColorMode, getPaths } from '../../../packages/core/src/index.js';
import { WIDGETS, LAYOUTS } from './widgets.js';
import { makePainter } from './paint.js';
import { labelsFor } from './labels.js';
import { normalize, formatDuration } from './data.js';
import { readGit } from './git.js';

let registered = false;
export function registerWidgets() {
  if (registered) return;
  for (const w of WIDGETS) if (!registry.get('widget', w.id)) registry.register({ kind: 'widget', ...w });
  registered = true;
}

export function layoutRows(config) {
  const c = config.cockpit;
  if (c.layout === 'custom' && Array.isArray(c.rows) && c.rows.length) return c.rows;
  return LAYOUTS[c.layout] ?? LAYOUTS.cockpit;
}

/** Render one row, dropping lowest-priority widgets until it fits `width`. */
export function renderRow(ids, d, ctx, width) {
  let items = ids
    .filter((id) => !ctx.config.cockpit.hide.includes(id))
    .map((id) => registry.get('widget', id))
    .filter(Boolean)
    .map((w) => {
      let text = null;
      try {
        text = w.render(d, ctx);
      } catch {
        text = null; // one broken widget never breaks the status line
      }
      return text ? { id: w.id, priority: w.priority ?? 0, text } : null;
    })
    .filter(Boolean);

  const sep = ctx.paint.sep();
  const sepW = visibleWidth(sep);
  const total = () => items.reduce((n, it) => n + visibleWidth(it.text), 0) + sepW * Math.max(0, items.length - 1);
  while (items.length > 1 && width > 0 && total() > width) {
    const lowest = items.reduce((a, b) => (b.priority < a.priority ? b : a));
    items = items.filter((it) => it !== lowest);
  }
  return items.map((it) => it.text).join(sep);
}

export function terminalWidth(config, env = process.env) {
  const cols = Number(env.COLUMNS);
  // Claude Code sets COLUMNS for status line commands; leave room for its own padding.
  return Number.isFinite(cols) && cols > 20 ? cols - 4 : config.cockpit.maxWidth;
}

/**
 * Full status line render.
 * opts: { config, theme, now, git (override), updateNotice, env, colorMode }
 */
export function renderStatusLine(raw, opts) {
  registerWidgets();
  const { config, theme } = opts;
  const now = opts.now ?? Date.now();
  const d = normalize(raw);
  const paths = opts.paths ?? getPaths();
  d.git = opts.git !== undefined
    ? opts.git
    : config.cockpit.git.enabled
      ? readGit(d.cwd, { cacheDir: paths.cache, cacheMs: config.cockpit.git.cacheMs, now })
      : null;
  d.updateNotice = opts.updateNotice ?? null;

  const mode = opts.colorMode ?? detectColorMode(config.color.mode, opts.env ?? process.env);
  const paint = makePainter(theme, mode);
  const L = labelsFor(config.cockpit.locale);
  const na = (label) => (config.cockpit.showUnavailable ? `${paint.color('muted', label)} ${paint.color('muted', L.na)}` : null);
  const ctx = { paint, L, config, theme, now, na };
  const width = opts.width ?? terminalWidth(config, opts.env ?? process.env);

  return layoutRows(config)
    .map((ids) => renderRow(ids, d, ctx, width))
    .filter((line) => line.length)
    .join('\n');
}

/**
 * Agent panel rows (subagentStatusLine). Input: { columns, tasks: [...] }.
 * Output: one JSON line per task: {"id": "...", "content": "..."}.
 */
export function renderSubagentRows(input, { config, theme, now = Date.now(), colorMode } = {}) {
  const mode = colorMode ?? detectColorMode(config.color.mode);
  const paint = makePainter(theme, mode);
  const cols = Number(input?.columns) > 10 ? Number(input.columns) : 100;
  const lines = [];
  for (const t of input?.tasks ?? []) {
    if (!t?.id) continue;
    const status = t.status ?? 'running';
    const icon = {
      running: paint.color('accent', '●'),
      completed: paint.color('success', '✓'),
      failed: paint.color('error', '✗'),
      killed: paint.color('muted', '■'),
    }[status] ?? paint.color('muted', '○');
    const name = paint.strong('secondary', t.name || t.agentType || 'agent');
    const meta = [];
    if (t.model) meta.push(t.model);
    if (t.effort !== undefined) meta.push(String(t.effort));
    const elapsed = typeof t.startTime === 'number' ? formatDuration(now - t.startTime) : null;
    if (elapsed) meta.push(elapsed);
    let ctxPart = '';
    if (typeof t.tokenCount === 'number') {
      if (typeof t.contextWindowSize === 'number' && t.contextWindowSize > 0) {
        const p = (t.tokenCount / t.contextWindowSize) * 100;
        ctxPart = `${paint.bar(p, 5)} ${paint.color(paint.level(p), `${Math.round(p)}%`)}`;
      } else {
        ctxPart = paint.color('muted', `${Math.round(t.tokenCount / 1000)}k tok`);
      }
    }
    const fixed = [icon, name, ctxPart, paint.color('muted', meta.join(' · '))].filter(Boolean).join(' ');
    const room = cols - visibleWidth(fixed) - 3;
    let label = String(t.label || t.description || '');
    if (room < 8) label = '';
    else if (visibleWidth(label) > room) label = `${[...label].slice(0, room - 1).join('')}…`;
    const content = label ? `${fixed} ${paint.color('foreground', label)}` : fixed;
    lines.push(JSON.stringify({ id: t.id, content }));
  }
  return lines.join('\n');
}
