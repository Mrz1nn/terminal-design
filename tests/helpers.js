import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const created = [];
process.on('exit', () => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

/** Point every Terminal-Design path at a fresh temp folder (removed on exit). Returns the root. */
export function isolate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'td-test-'));
  created.push(root);
  process.env.TD_DATA_HOME = path.join(root, 'data');
  process.env.TD_CONFIG_HOME = path.join(root, 'config');
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
  return root;
}

export const REAL_PAYLOAD = {
  session_id: 'ee256bb1-3c9e-4ace-a062-238c41f38c36',
  cwd: 'C:\\dev\\proj',
  effort: { level: 'medium' },
  session_name: 'teste',
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  workspace: { current_dir: 'C:\\dev\\proj\\src', project_dir: 'C:\\dev\\proj', added_dirs: [] },
  version: '2.1.322',
  output_style: { name: 'default' },
  cost: { total_cost_usd: 0.969, total_duration_ms: 626331, total_api_duration_ms: 173925, total_lines_added: 91, total_lines_removed: 10 },
  context_window: {
    total_input_tokens: 94173,
    total_output_tokens: 8,
    context_window_size: 1000000,
    current_usage: { input_tokens: 2, output_tokens: 8, cache_creation_input_tokens: 411, cache_read_input_tokens: 93760 },
    used_percentage: 9,
    remaining_percentage: 91,
  },
  exceeds_200k_tokens: false,
  prompt_cache: { warm: true, ttl: '1h', hit_ratio: 0.952 },
  fast_mode: false,
  thinking: { enabled: true },
  rate_limits: {
    five_hour: { used_percentage: 36, resets_at: 1794446400 },
    seven_day: { used_percentage: 13, resets_at: 1794967200 },
  },
};
