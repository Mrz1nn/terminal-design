// Normalizes the JSON Claude Code pipes to status line commands into one stable shape.
// Rule: every value comes from the official payload (https://code.claude.com/docs/en/statusline).
// Anything missing stays null; widgets decide whether to hide it or show "n/d".
// Nothing is estimated or invented here.

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' && v.length ? v : null);

function limit(o) {
  if (!o || typeof o !== 'object') return null;
  const pct = num(o.used_percentage);
  if (pct === null) return null;
  return { usedPct: pct, resetsAt: num(o.resets_at) };
}

export function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  const cw = raw.context_window ?? {};
  const cu = cw.current_usage ?? null;
  const size = num(cw.context_window_size);
  const usedTokens = cu
    ? (num(cu.input_tokens) ?? 0) + (num(cu.cache_creation_input_tokens) ?? 0) + (num(cu.cache_read_input_tokens) ?? 0)
    : null;
  const usedPct = num(cw.used_percentage);
  const cwd = str(raw.workspace?.current_dir) ?? str(raw.cwd);
  const projectDir = str(raw.workspace?.project_dir) ?? cwd;
  const rl = raw.rate_limits ?? {};
  const spend = rl.spend_limit && num(rl.spend_limit.used_percentage) !== null
    ? {
        usedPct: num(rl.spend_limit.used_percentage),
        resetsAt: num(rl.spend_limit.resets_at),
        usedUsd: num(rl.spend_limit.used_usd),
        limitUsd: num(rl.spend_limit.limit_usd),
        period: str(rl.spend_limit.period),
      }
    : null;

  return {
    sessionId: str(raw.session_id),
    sessionName: str(raw.session_name),
    claudeVersion: str(raw.version),
    model: {
      id: str(raw.model?.id),
      name: str(raw.model?.display_name),
    },
    effort: str(raw.effort?.level) ?? (num(raw.effort?.level) !== null ? String(raw.effort.level) : null),
    thinking: typeof raw.thinking?.enabled === 'boolean' ? raw.thinking.enabled : null,
    fastMode: typeof raw.fast_mode === 'boolean' ? raw.fast_mode : null,
    context: {
      size,
      usedPct,
      remainingPct: num(cw.remaining_percentage) ?? (usedPct !== null ? 100 - usedPct : null),
      usedTokens,
      remainingTokens: size !== null && usedTokens !== null ? Math.max(0, size - usedTokens) : null,
      exceeds200k: typeof raw.exceeds_200k_tokens === 'boolean' ? raw.exceeds_200k_tokens : null,
    },
    limits: {
      fiveHour: limit(rl.five_hour),
      sevenDay: limit(rl.seven_day),
      // Claude Code does not expose a monthly subscription limit. Only gateway spend limits
      // can have period "monthly"; they arrive in `spend`.
      spend,
    },
    cost: {
      // total_cost_usd is Claude Code's client-side estimate at API prices, not a bill.
      estimatedUsd: num(raw.cost?.total_cost_usd),
      durationMs: num(raw.cost?.total_duration_ms),
      apiDurationMs: num(raw.cost?.total_api_duration_ms),
      linesAdded: num(raw.cost?.total_lines_added),
      linesRemoved: num(raw.cost?.total_lines_removed),
    },
    cache: raw.prompt_cache
      ? { warm: raw.prompt_cache.warm ?? null, hitRatio: num(raw.prompt_cache.hit_ratio), ttl: str(raw.prompt_cache.ttl), expiresAt: num(raw.prompt_cache.expires_at) }
      : null,
    cwd,
    projectDir,
    // Claude Code on Windows sends backslash paths; take the last segment on any OS (WSL, CI).
    projectName: projectDir ? baseName(projectDir) : null,
    addedDirs: Array.isArray(raw.workspace?.added_dirs) ? raw.workspace.added_dirs.length : 0,
    agentName: str(raw.agent?.name),
    vimMode: str(raw.vim?.mode),
    outputStyle: str(raw.output_style?.name),
    // Not present in the official payload; kept explicit so the UI can say "n/d".
    permissionMode: str(raw.permission_mode),
    pr: raw.pr && num(raw.pr.number) !== null ? { number: raw.pr.number, url: str(raw.pr.url), reviewState: str(raw.pr.review_state) } : null,
    worktree: raw.worktree ? { name: str(raw.worktree.name), branch: str(raw.worktree.branch) } : null,
    repo: raw.workspace?.repo ?? null,
  };
}

function baseName(p) {
  const parts = String(p).replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || null;
}

export function formatTokens(n) {
  if (n === null || n === undefined) return null;
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function formatDuration(ms) {
  if (ms === null || ms === undefined || ms < 0) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d${h ? `${h}h` : ''}`;
  if (h) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

/** "2h10m" until an epoch-seconds timestamp, or null. */
export function untilEpoch(epochSec, now = Date.now()) {
  if (epochSec === null || epochSec === undefined) return null;
  return formatDuration(Math.max(0, epochSec * 1000 - now));
}
