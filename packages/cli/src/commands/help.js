import { registry } from '../../../core/src/index.js';
import { UsageError } from '../errors.js';

export default {
  id: 'help',
  maxArgs: 1,
  summary: 'Mostra todos os comandos',
  usage: ['td help', 'td help <comando>', 'td <comando> --help'],
  run({ args, ctx }) {
    const { ui } = ctx;
    if (args[0]) {
      // td help <comando> = td <comando> --help
      const cmd = registry.get('command', args[0]);
      if (!cmd) throw new UsageError(`comando desconhecido: ${args[0]}`);
      ui.title(`td ${cmd.id}`);
      ui.print(`  ${cmd.summary}
`);
      for (const u of cmd.usage ?? []) ui.print(`  ${ui.c.accent(u)}`);
      return 0;
    }
    ui.title(`Terminal-Design ${ctx.version}`);
    ui.print(`  ${ui.c.muted('uso:')} td ${ui.c.accent('<comando>')} ${ui.c.muted('[opções]')}\n`);
    const cmds = registry.list('command').filter((c) => !c.hidden);
    ui.table(cmds.map((c) => [c.id === 'dashboard' ? 'td' : `td ${c.id}`, c.summary]));
    ui.print('');
    ui.print(`  ${ui.c.muted('Detalhes de um comando:')} ${ui.c.accent('td <comando> --help')}`);
    ui.print(`  ${ui.c.muted('Sem cores:')} ${ui.c.accent('--no-color')} ${ui.c.muted('ou a variável NO_COLOR')}`);
  },
};
