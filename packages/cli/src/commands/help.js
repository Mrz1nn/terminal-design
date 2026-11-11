import { registry } from '../../../core/src/index.js';

export default {
  id: 'help',
  summary: 'Mostra todos os comandos',
  usage: ['td help', 'td <comando> --help'],
  run({ ctx }) {
    const { ui } = ctx;
    ui.title(`Terminal-Design ${ctx.version}`);
    ui.print(`  ${ui.c.muted('uso:')} td ${ui.c.accent('<comando>')} ${ui.c.muted('[opções]')}\n`);
    const cmds = registry.list('command').filter((c) => !c.hidden);
    ui.table(cmds.map((c) => [c.id === 'dashboard' ? 'td' : `td ${c.id}`, c.summary]));
    ui.print('');
    ui.print(`  ${ui.c.muted('Detalhes de um comando:')} ${ui.c.accent('td <comando> --help')}`);
    ui.print(`  ${ui.c.muted('Sem cores:')} ${ui.c.accent('--no-color')} ${ui.c.muted('ou a variável NO_COLOR')}`);
  },
};
