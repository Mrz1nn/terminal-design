import { runStatusLine } from '../../../../apps/terminal-cockpit/src/index.js';

export default {
  id: 'statusline',
  maxArgs: 0,
  hidden: true,
  summary: 'Renderiza a status line (chamado pelo Claude Code, lê JSON do stdin)',
  usage: ['td statusline < payload.json', 'td statusline --subagent < tasks.json'],
  run({ flags }) {
    return runStatusLine({ subagent: !!flags.subagent });
  },
};
