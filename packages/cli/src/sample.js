// Example payload used ONLY for theme previews (`td theme preview`), always labeled as an example.
// It mirrors the shape Claude Code 2.1.x sends; values are illustrative, never shown as real data.
const now = Date.UTC(2026, 0, 1, 12, 0, 0);

export const SAMPLE_PAYLOAD = {
  _now: now,
  _git: { branch: 'main', detached: false, ahead: 1, behind: 0, staged: 2, modified: 3, untracked: 1, conflicts: 0, dirty: 6 },
  session_name: 'exemplo',
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  effort: { level: 'high' },
  thinking: { enabled: true },
  workspace: { current_dir: 'C:\\dev\\meu-projeto', project_dir: 'C:\\dev\\meu-projeto', added_dirs: [] },
  version: '2.1.322',
  cost: { total_cost_usd: 1.234, total_duration_ms: 1_860_000, total_lines_added: 128, total_lines_removed: 42 },
  context_window: {
    context_window_size: 1_000_000,
    used_percentage: 34,
    remaining_percentage: 66,
    current_usage: { input_tokens: 1200, cache_creation_input_tokens: 8800, cache_read_input_tokens: 330000 },
  },
  prompt_cache: { warm: true, ttl: '1h', hit_ratio: 0.93 },
  rate_limits: {
    five_hour: { used_percentage: 62, resets_at: now / 1000 + 2 * 3600 + 15 * 60 },
    seven_day: { used_percentage: 18, resets_at: now / 1000 + 4 * 86400 },
  },
};
