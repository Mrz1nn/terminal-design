// Built-in status line widgets.
//
// Widget contract (also the future plugin contract):
//   { id, kind: 'widget', group, priority, render(d, ctx) -> string | null }
//   d   = normalized data (data.js) + d.git (git.js) + d.updateNotice
//   ctx = { paint, L (labels), config, theme, now, na(label) }
// Higher priority survives longer when the line is too wide. Return null to hide.
import { formatTokens, formatDuration, untilEpoch } from './data.js';

const pct = (n) => `${Math.round(n)}%`;

function limitWidget(id, label, pick, priority) {
  return {
    id,
    group: 'limits',
    priority,
    render(d, { paint, L, na, now, theme }) {
      const l = pick(d);
      if (!l) return na(L[label]);
      // After the reset time the old percentage is no longer true; hide until Claude Code sends a new one.
      if (l.resetsAt !== null && l.resetsAt * 1000 <= now) return na(L[label]);
      const w = Math.max(3, Math.round(theme.style.bar.width / 2));
      const reset = untilEpoch(l.resetsAt, now);
      return [
        paint.color('muted', L[label]),
        paint.bar(l.usedPct, w),
        paint.color(paint.level(l.usedPct), pct(l.usedPct)),
        reset ? paint.color('muted', `${L.reset}${reset}`) : '',
      ].filter(Boolean).join(' ');
    },
  };
}

export const WIDGETS = [
  {
    id: 'model',
    group: 'model',
    priority: 100,
    render(d, { paint, L }) {
      if (!d.model.name && !d.model.id) return null;
      const parts = [paint.strong('primary', d.model.name ?? d.model.id)];
      if (d.effort) parts.push(paint.color('secondary', d.effort));
      if (d.thinking) parts.push(paint.color('muted', L.thinking));
      if (d.fastMode) parts.push(paint.color('accent', L.fast));
      return parts.join(' ');
    },
  },
  {
    id: 'context',
    group: 'context',
    priority: 95,
    render(d, { paint, L, na }) {
      const c = d.context;
      if (c.usedPct === null) return na(L.ctx);
      const tokens = c.usedTokens !== null && c.size !== null ? paint.color('muted', `${formatTokens(c.usedTokens)}/${formatTokens(c.size)}`) : '';
      return [paint.color('muted', L.ctx), paint.bar(c.usedPct), paint.color(paint.level(c.usedPct), pct(c.usedPct)), tokens].filter(Boolean).join(' ');
    },
  },
  limitWidget('limit5h', 'fiveHour', (d) => d.limits.fiveHour, 90),
  limitWidget('limit7d', 'sevenDay', (d) => d.limits.sevenDay, 85),
  {
    id: 'spend',
    group: 'limits',
    priority: 80,
    render(d, { paint, L, now }) {
      const s = d.limits.spend;
      if (!s) return null; // only exists behind a Claude apps gateway
      if (s.resetsAt !== null && s.resetsAt * 1000 <= now) return null; // stale after reset
      const money = s.usedUsd !== null && s.limitUsd !== null ? paint.color('muted', `$${s.usedUsd.toFixed(0)}/$${s.limitUsd.toFixed(0)}`) : '';
      const period = s.period ? paint.color('muted', L.periods[s.period] ?? s.period) : '';
      const reset = untilEpoch(s.resetsAt, now);
      return [paint.color('muted', L.spend), paint.bar(s.usedPct, 5), paint.color(paint.level(s.usedPct), pct(s.usedPct)), money, period, reset ? paint.color('muted', `${L.reset}${reset}`) : '']
        .filter(Boolean).join(' ');
    },
  },
  {
    // Claude Code exposes no monthly subscription limit. Shown only as "n/d" when the user
    // opts in with cockpit.showUnavailable, so it is never faked.
    id: 'monthly',
    group: 'limits',
    priority: 10,
    render(d, { L, na }) {
      if (d.limits.spend?.period === 'monthly') return null; // already shown by `spend`
      return na(L.monthly);
    },
  },
  {
    id: 'dir',
    group: 'workspace',
    priority: 70,
    render(d, { paint }) {
      if (!d.projectName) return null;
      let sub = '';
      if (d.cwd && d.projectDir && d.cwd !== d.projectDir && d.cwd.startsWith(d.projectDir)) {
        sub = paint.color('muted', d.cwd.slice(d.projectDir.length).replace(/\\/g, '/'));
      }
      const extra = d.addedDirs ? paint.color('muted', ` +${d.addedDirs}`) : '';
      return `${paint.strong('accent', d.projectName)}${sub}${extra}`;
    },
  },
  {
    id: 'git',
    group: 'workspace',
    priority: 75,
    render(d, { paint }) {
      const g = d.git;
      if (!g || !g.branch) return null;
      const parts = [paint.color('secondary', `⎇ ${g.branch}`)];
      if (g.conflicts) parts.push(paint.color('error', `✗${g.conflicts}`));
      if (g.staged) parts.push(paint.color('success', `+${g.staged}`));
      if (g.modified) parts.push(paint.color('warning', `~${g.modified}`));
      if (g.untracked) parts.push(paint.color('muted', `?${g.untracked}`));
      if (!g.dirty) parts.push(paint.color('success', '✓'));
      if (g.ahead) parts.push(paint.color('accent', `↑${g.ahead}`));
      if (g.behind) parts.push(paint.color('warning', `↓${g.behind}`));
      return parts.join(' ');
    },
  },
  {
    id: 'changes',
    group: 'session',
    priority: 50,
    render(d, { paint }) {
      const { linesAdded: a, linesRemoved: r } = d.cost;
      if (!a && !r) return null;
      return `${paint.color('success', `+${a ?? 0}`)} ${paint.color('error', `−${r ?? 0}`)}`;
    },
  },
  {
    id: 'cost',
    group: 'session',
    priority: 40,
    render(d, { paint, L }) {
      if (d.cost.estimatedUsd === null) return null;
      return paint.color('muted', `$${d.cost.estimatedUsd.toFixed(2)} ${L.est}`);
    },
  },
  {
    id: 'duration',
    group: 'session',
    priority: 35,
    render(d, { paint }) {
      const t = formatDuration(d.cost.durationMs);
      return t ? paint.color('muted', `⏱ ${t}`) : null;
    },
  },
  {
    id: 'agent',
    group: 'agents',
    priority: 60,
    render(d, { paint, L }) {
      return d.agentName ? `${paint.color('muted', L.agent)} ${paint.color('secondary', d.agentName)}` : null;
    },
  },
  {
    id: 'mode',
    group: 'mode',
    priority: 30,
    render(d, { paint, L, na }) {
      const parts = [];
      if (d.vimMode) parts.push(paint.color('accent', d.vimMode));
      if (d.outputStyle && d.outputStyle !== 'default') parts.push(paint.color('muted', d.outputStyle));
      if (d.permissionMode) parts.push(paint.color('warning', d.permissionMode));
      else {
        const missing = na(L.permission);
        if (missing) parts.push(missing);
      }
      return parts.length ? parts.join(' ') : null;
    },
  },
  {
    id: 'session',
    group: 'session',
    priority: 25,
    render(d, { paint }) {
      return d.sessionName ? paint.color('foreground', d.sessionName) : null;
    },
  },
  {
    id: 'cache',
    group: 'session',
    priority: 20,
    render(d, { paint, L }) {
      if (!d.cache || d.cache.hitRatio === null) return null;
      const key = d.cache.warm === false ? 'warning' : 'muted';
      return paint.color(key, `${L.cache} ${pct(d.cache.hitRatio * 100)}${d.cache.ttl ? ` ${d.cache.ttl}` : ''}`);
    },
  },
  {
    id: 'pr',
    group: 'workspace',
    priority: 45,
    render(d, { paint }) {
      if (!d.pr) return null;
      const s = d.pr.reviewState ? ` ${d.pr.reviewState}` : '';
      const label = paint.color('accent', `PR #${d.pr.number}${s}`);
      // OSC 8 link (documented as supported by the Claude Code status line).
      return d.pr.url && paint.mode !== 'none' ? `\x1b]8;;${d.pr.url}\x07${label}\x1b]8;;\x07` : label;
    },
  },
  {
    id: 'worktree',
    group: 'workspace',
    priority: 44,
    render(d, { paint }) {
      return d.worktree?.name ? paint.color('muted', `wt:${d.worktree.name}`) : null;
    },
  },
  {
    id: 'claudeVersion',
    group: 'meta',
    priority: 15,
    render(d, { paint }) {
      return d.claudeVersion ? paint.color('muted', `CC ${d.claudeVersion}`) : null;
    },
  },
  {
    id: 'update',
    group: 'meta',
    priority: 65,
    render(d, { paint, L }) {
      const u = d.updateNotice;
      if (!u) return null;
      if (typeof u === 'string') return paint.color('warning', u);
      // Update "button": clickable (OSC 8) to the release notes, plus the command that installs it.
      const button = paint.strong('warning', `[ ↑ ${L.update} ${u.version} ]`);
      const link = u.url && paint.mode !== 'none' ? `]8;;${u.url}${button}]8;;` : button;
      return `${link} ${paint.color('accent', u.command)}`;
    },
  },
  {
    // Onboarding tip for the first days (never together with the update button).
    id: 'tip',
    group: 'meta',
    priority: 60,
    render(d, { paint }) {
      if (!d.tip || d.updateNotice) return null;
      return paint.color('muted', d.tip);
    },
  },
];

export const LAYOUTS = {
  compact: [['model', 'context', 'limit5h', 'limit7d', 'git', 'update', 'tip']],
  cockpit: [
    ['model', 'context', 'limit5h', 'limit7d', 'spend'],
    ['dir', 'git', 'pr', 'agent', 'changes', 'cost', 'duration', 'update', 'tip'],
  ],
  full: [
    ['model', 'context', 'limit5h', 'limit7d', 'spend', 'monthly'],
    ['dir', 'git', 'pr', 'worktree', 'agent', 'changes', 'cost', 'duration'],
    ['session', 'mode', 'cache', 'claudeVersion', 'update', 'tip'],
  ],
};
