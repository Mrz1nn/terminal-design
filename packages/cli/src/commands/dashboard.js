// `td` with no arguments: the main panel.
// Shows real data only: the last payload Claude Code actually sent (with its age),
// live git state of the current folder, and the local installation state.
import { visibleWidth } from '../../../core/src/index.js';
import { renderStatusLine, readLastPayload } from '../../../../apps/terminal-cockpit/src/index.js';
import { formatDuration } from '../../../../apps/terminal-cockpit/src/data.js';
import { readGit } from '../../../../apps/terminal-cockpit/src/git.js';
import * as cc from '../../../../integrations/claude-code/index.js';

function box(lines, theme, ui, title) {
  const b = theme.borderChars;
  if (!b.h) return [title ? ui.c.bold(title) : '', ...lines].filter((l) => l !== '').join('\n');
  const tw = title ? visibleWidth(title) + 3 : 0; // "─ title "
  const inner = Math.max(tw + 2, ...lines.map((l) => visibleWidth(l) + 2));
  const top = title
    ? `${ui.c.muted(b.tl + b.h)} ${ui.c.bold(ui.c.primary(title))} ${ui.c.muted(b.h.repeat(inner - tw) + b.tr)}`
    : ui.c.muted(b.tl + b.h.repeat(inner) + b.tr);
  const body = lines.map((l) => `${ui.c.muted(b.v)} ${l}${' '.repeat(Math.max(0, inner - visibleWidth(l) - 1))}${ui.c.muted(b.v)}`);
  return [top, ...body, ui.c.muted(b.bl + b.h.repeat(inner) + b.br)].join('\n');
}

async function updateLine(ctx) {
  try {
    const mod = await import('../../../updater/src/index.js');
    if (typeof mod.getUpdateInfo === 'function') return mod.getUpdateInfo({ config: ctx.config, offline: true });
  } catch { /* updater not available */ }
  return null;
}

export default {
  id: 'dashboard',
  summary: 'Painel principal com as informações disponíveis',
  usage: ['td'],
  async run({ ctx }) {
    const { ui, theme, paths, config } = ctx;
    const cols = Math.min(process.stdout.columns || 100, 120);
    const out = [];

    // Claude Code session
    const last = readLastPayload(paths);
    const session = [];
    if (last?.payload) {
      const age = formatDuration(Date.now() - last.receivedAt);
      const lines = renderStatusLine(last.payload, {
        config: { ...config, cockpit: { ...config.cockpit, layout: 'full' } },
        theme,
        paths,
        width: cols - 6,
        colorMode: ui.mode,
        git: null,
      }).split('\n');
      session.push(...lines, ui.c.muted(`dados reais da última atualização do Claude Code, há ${age}`));
    } else {
      session.push(ui.c.muted('Nenhum dado ainda. Abra o Claude Code com a integração instalada:'));
      session.push(ui.c.accent('td claude install'));
    }
    out.push(box(session, theme, ui, 'Claude Code'));

    // Workspace
    const g = readGit(process.cwd(), { cacheDir: paths.cache, cacheMs: 0 });
    const ws = [`${ui.c.muted('pasta')}  ${process.cwd()}`];
    if (g?.branch) {
      const state = g.dirty ? ui.c.warning(`${g.dirty} alteração(ões) pendente(s)`) : ui.c.success('limpo');
      const sync = [g.ahead ? `↑${g.ahead}` : '', g.behind ? `↓${g.behind}` : ''].filter(Boolean).join(' ');
      ws.push(`${ui.c.muted('git')}    ${ui.c.secondary(`⎇ ${g.branch}`)}  ${state}${sync ? `  ${ui.c.accent(sync)}` : ''}${g.upstream ? ui.c.muted(`  ${g.upstream}`) : ''}`);
    } else {
      ws.push(`${ui.c.muted('git')}    ${ui.c.muted('não é um repositório git')}`);
    }
    out.push(box(ws, theme, ui, 'Workspace'));

    // Installation
    const st = cc.status(paths);
    const info = await updateLine(ctx);
    // Update "button": Ctrl+click opens the release notes (OSC 8), the command installs it.
    let notice = null;
    if (info) {
      const label = `[ ↑ atualizar para ${info.version} ]`;
      const button = info.url && ui.mode !== 'none' ? `\x1b]8;;${info.url}\x07${ui.c.bold(ui.c.warning(label))}\x1b]8;;\x07` : ui.c.bold(ui.c.warning(label));
      notice = `${button} ${ui.c.accent(info.command)}`;
    }
    const inst = [
      `${ui.c.muted('versão')}       ${ctx.version} ${ui.c.muted(`(${ctx.mode})`)}${notice ? `  ${notice}` : ''}`,
      `${ui.c.muted('tema')}         ${theme.displayName ?? theme.name}`,
      `${ui.c.muted('claude code')}  ${st.installed ? ui.c.success('status line ativa') : ui.c.muted('não integrado')}`,
      `${ui.c.muted('voz')}          ${config.voice.enabled ? `${config.voice.hotkey} · ${config.voice.language}` : ui.c.muted('desativada')}`,
    ];
    out.push(box(inst, theme, ui, 'Terminal-Design'));

    ui.print(out.join('\n'));
    ui.print(`  ${ui.c.muted('td help para todos os comandos')}`);
  },
};
