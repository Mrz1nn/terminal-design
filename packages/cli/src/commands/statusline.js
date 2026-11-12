import { runStatusLine } from '../../../../apps/terminal-cockpit/src/index.js';
import { ensureCommands, updateCommandHint, onboardingTip } from '../../../../integrations/claude-code/index.js';

export default {
  id: 'statusline',
  maxArgs: 0,
  hidden: true,
  summary: 'Renderiza a status line (chamado pelo Claude Code, lê JSON do stdin)',
  usage: ['td statusline < payload.json', 'td statusline --subagent < tasks.json'],
  async run({ flags, ctx }) {
    // Only when Claude Code itself runs us (--from marker): keep /tema and /td installed
    // (once per command version), point the update button at /td and show the first-days tip.
    const fromClaude = !flags.subagent && flags.from === 'terminal-design';
    let updateCommand = null;
    let tip = null;
    if (fromClaude) {
      try { ensureCommands(ctx.paths); } catch { /* never break the status line */ }
      try { updateCommand = updateCommandHint(ctx.paths); } catch { /* plain td update */ }
      try { tip = onboardingTip(ctx.paths, ctx.config); } catch { /* no tip */ }
    }
    return runStatusLine({ subagent: !!flags.subagent, updateCommand, tip });
  },
};
