import { runStatusLine } from '../../../../apps/terminal-cockpit/src/index.js';
import { ensureCommands } from '../../../../integrations/claude-code/index.js';

export default {
  id: 'statusline',
  maxArgs: 0,
  hidden: true,
  summary: 'Renderiza a status line (chamado pelo Claude Code, lê JSON do stdin)',
  usage: ['td statusline < payload.json', 'td statusline --subagent < tasks.json'],
  async run({ flags, ctx }) {
    const code = await runStatusLine({ subagent: !!flags.subagent });
    // Only when Claude Code itself runs us: make sure /tema exists (once per command version).
    if (!flags.subagent && flags.from === 'terminal-design') {
      try { ensureCommands(ctx.paths); } catch { /* never break the status line */ }
    }
    return code;
  },
};
