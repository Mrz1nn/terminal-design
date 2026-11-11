import { spawnSync } from 'node:child_process';
import * as cc from '../../../../integrations/claude-code/index.js';

function claudeVersion() {
  try {
    // Fixed command string (no user input), shell needed on Windows to resolve claude.cmd.
    const r = spawnSync('claude --version', { encoding: 'utf8', timeout: 8000, shell: true, windowsHide: true });
    const m = /(\d+\.\d+\.\d+)/.exec(r.stdout ?? '');
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export default {
  id: 'claude',
  summary: 'Instala, remove ou mostra a integração com o Claude Code',
  usage: [
    'td claude status',
    'td claude install [--no-subagent] [--yes]',
    'td claude uninstall',
  ],
  async run({ args, flags, ctx }) {
    const { ui, paths } = ctx;
    const sub = args[0] ?? 'status';
    const st = cc.status(paths);
    if (st.error) {
      ui.error(st.error);
      return 1;
    }
    if (sub === 'status') {
      ui.title('Claude Code');
      ui.table([
        ['settings', st.settingsFile],
        ['status line', st.installed ? ui.c.success('Terminal-Design') : st.statusLine ? ui.c.warning('outra (de terceiros)') : ui.c.muted('nenhuma')],
        ['painel de agentes', st.subagentInstalled ? ui.c.success('Terminal-Design') : st.subagentStatusLine ? ui.c.warning('outro') : ui.c.muted('padrão')],
      ]);
      return;
    }
    if (sub === 'install') {
      if (st.foreign && !flags.yes) {
        ui.warn(`Já existe outra status line: ${ui.c.muted(st.statusLine.command ?? JSON.stringify(st.statusLine))}`);
        const ok = await ui.confirm('Substituir? (ela fica guardada e volta no td claude uninstall)', false);
        if (!ok) return 1;
      }
      const r = cc.install(paths, { subagent: flags.subagent !== false });
      ui.ok('Status line do Terminal-Design instalada no Claude Code.');
      if (r.backup) ui.print(`  ${ui.c.muted(`backup: ${r.backup}`)}`);
      ui.print(`  ${ui.c.muted('Aparece na próxima mensagem do Claude Code (ou reabra a sessão).')}`);
      return;
    }
    if (sub === 'uninstall' || sub === 'remove') {
      const r = cc.uninstall(paths);
      if (!r.changed) ui.info('Nada para remover: a status line atual não é do Terminal-Design.');
      else ui.ok(r.restored ? 'Integração removida; a status line anterior foi restaurada.' : 'Integração removida.');
      return;
    }
    throw new Error(`subcomando desconhecido: ${sub}`);
  },
  doctor(ctx) {
    const st = cc.status(ctx.paths);
    const v = claudeVersion();
    if (st.error) return [{ name: 'Claude Code settings', ok: false, detail: st.error }];
    return [
      { name: 'Claude Code', ok: v ? true : null, detail: v ? `versão ${v}` : 'comando "claude" não encontrado no PATH' },
      { name: 'Status line', ok: st.installed ? true : null, detail: st.installed ? 'Terminal-Design ativa' : st.foreign ? 'outra status line instalada' : 'não instalada (td claude install)' },
    ];
  },
};
