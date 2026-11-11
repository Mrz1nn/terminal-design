import path from 'node:path';
import readline from 'node:readline';
import { listThemes, loadTheme, normalizeTheme, importTheme, exportTheme, PALETTE_KEYS } from '../../../themes/src/index.js';
import { setConfigValue } from '../../../config/src/index.js';
import { fg, RESET } from '../../../core/src/index.js';
import { renderStatusLine } from '../../../../apps/terminal-cockpit/src/index.js';
import { SAMPLE_PAYLOAD } from '../sample.js';
import * as wt from '../../../../integrations/windows-terminal/index.js';
import * as vscode from '../../../../integrations/vscode/index.js';

function swatches(theme, mode) {
  if (mode === 'none') return '';
  const t = normalizeTheme(theme);
  return PALETTE_KEYS.filter((k) => k !== 'background' && k !== 'surface').map((k) => `${fg(t.palette[k], mode)}●${RESET}`).join('');
}

function preview(name, ctx) {
  const theme = normalizeTheme(loadTheme(name, ctx.paths));
  const config = { ...ctx.config, theme: { name, overrides: {} } };
  return renderStatusLine(SAMPLE_PAYLOAD, { config, theme, git: SAMPLE_PAYLOAD._git, width: 110, colorMode: ctx.ui.mode, now: SAMPLE_PAYLOAD._now });
}

async function pick(ctx) {
  const themes = listThemes(ctx.paths).filter((t) => !t.errors.length);
  const { ui } = ctx;
  if (!process.stdin.isTTY) return listCmd(ctx);
  ui.title('Escolha um tema');
  themes.forEach((t, i) => {
    const cur = t.name === ctx.config.theme.name ? ui.c.success(' (atual)') : '';
    ui.print(`  ${ui.c.accent(String(i + 1).padStart(2))}  ${swatches(t.theme, ui.mode)}  ${t.displayName}${cur}`);
  });
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) => rl.question(`\n${ui.c.accent('?')} Número do tema (Enter cancela): `, r));
  rl.close();
  const n = Number(answer.trim());
  if (!n || !themes[n - 1]) return ui.info('Nada alterado.');
  return setTheme(themes[n - 1].name, {}, ctx);
}

function listCmd(ctx) {
  const { ui } = ctx;
  ui.title('Temas disponíveis');
  for (const t of listThemes(ctx.paths)) {
    const cur = t.name === ctx.config.theme.name ? ui.c.success(' ● atual') : '';
    const origin = t.origin === 'user' ? ui.c.muted(' [usuário]') : '';
    const bad = t.errors.length ? ui.c.error(` inválido: ${t.errors[0]}`) : '';
    ui.print(`  ${t.errors.length ? '   ' : swatches(t.theme, ui.mode).padEnd(0)}  ${ui.c.bold(t.name.padEnd(17))} ${ui.c.muted(t.displayName ?? '')}${origin}${cur}${bad}`);
  }
  ui.print(`\n  ${ui.c.muted('Aplicar:')} ${ui.c.accent('td theme set <nome>')}   ${ui.c.muted('Ver:')} ${ui.c.accent('td theme preview <nome>')}`);
}

function setTheme(name, flags, ctx) {
  const { ui } = ctx;
  loadTheme(name, ctx.paths); // throws with a clear message if missing/invalid
  setConfigValue('theme.name', name, ctx.paths);
  ui.ok(`Tema ${ui.c.bold(name)} aplicado. A status line do Claude Code muda na próxima atualização.`);
  ui.print(preview(name, { ...ctx, config: { ...ctx.config, theme: { name, overrides: {} } } }).replace(/^/gm, '  '));
  if (flags.wt) {
    const r = wt.syncSchemes(ctx.paths);
    ui.ok(`Windows Terminal: ${r.count} esquemas em ${r.file}`);
    ui.print(`  ${ui.c.muted('Escolha "TD ' + (loadTheme(name, ctx.paths).displayName ?? name) + '" em Configurações > Perfil > Aparência > Esquema de cores.')}`);
  }
}

export default {
  id: 'theme',
  summary: 'Escolhe, lista, aplica, importa e exporta temas',
  usage: [
    'td theme                      seleção interativa',
    'td theme list                 lista os temas',
    'td theme set <nome> [--wt]    aplica (e, com --wt, envia ao Windows Terminal)',
    'td theme preview <nome>       mostra a status line com o tema',
    'td theme import <arquivo>     instala um tema .json [--force]',
    'td theme export <nome> <arq>  exporta (com personalizações) [--as <novo-nome>]',
    'td theme export <nome> <arq> --vscode   gera cores para o terminal do VS Code',
    'td theme wt                   sincroniza todos os temas com o Windows Terminal',
  ],
  async run({ args, flags, ctx }) {
    const [sub, a, b] = args;
    const { ui } = ctx;
    switch (sub) {
      case undefined:
        return pick(ctx);
      case 'list':
      case 'ls':
        return listCmd(ctx);
      case 'set':
      case 'use':
        if (!a) throw new Error('informe o nome: td theme set <nome>');
        return setTheme(a, flags, ctx);
      case 'preview':
        ui.print(preview(a ?? ctx.config.theme.name, ctx));
        return;
      case 'import': {
        if (!a) throw new Error('informe o arquivo: td theme import <arquivo.json>');
        const r = importTheme(path.resolve(a), ctx.paths, { force: !!flags.force });
        ui.ok(`Tema ${ui.c.bold(r.name)} instalado em ${r.file}`);
        return;
      }
      case 'export': {
        if (!a || !b) throw new Error('uso: td theme export <nome> <arquivo.json>');
        const out = path.resolve(b);
        if (flags.vscode) {
          vscode.writeSnippet(loadTheme(a, ctx.paths), out);
          ui.ok(`Cores do VS Code salvas em ${out}`);
          ui.print(`  ${ui.c.muted('Copie o bloco "workbench.colorCustomizations" para o settings.json do VS Code.')}`);
          return;
        }
        exportTheme(a, out, { config: ctx.config, paths: ctx.paths, as: typeof flags.as === 'string' ? flags.as : undefined });
        ui.ok(`Tema exportado para ${out}`);
        return;
      }
      case 'wt': {
        if (!wt.isWindowsTerminalInstalled()) ui.warn('Windows Terminal não encontrado; o fragmento será criado mesmo assim.');
        const r = wt.syncSchemes(ctx.paths);
        ui.ok(`${r.count} esquemas de cores enviados ao Windows Terminal (${r.file})`);
        return;
      }
      default:
        throw new Error(`subcomando desconhecido: ${sub} (veja td theme --help)`);
    }
  },
  doctor(ctx) {
    const all = listThemes(ctx.paths);
    const bad = all.filter((t) => t.errors.length);
    return [
      { name: 'Temas', ok: bad.length === 0, detail: `${all.length} encontrados${bad.length ? `, inválidos: ${bad.map((t) => t.name).join(', ')}` : ''}` },
      { name: 'Tema ativo', ok: all.some((t) => t.name === ctx.config.theme.name && !t.errors.length), detail: ctx.config.theme.name },
    ];
  },
};
