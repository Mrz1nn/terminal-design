import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { listThemes, loadTheme, normalizeTheme, importTheme, exportTheme, PALETTE_KEYS } from '../../../themes/src/index.js';
import { setConfigValue } from '../../../config/src/index.js';
import { fg, RESET } from '../../../core/src/index.js';
import { renderStatusLine } from '../../../../apps/terminal-cockpit/src/index.js';
import { SAMPLE_PAYLOAD } from '../sample.js';
import * as wt from '../../../../integrations/windows-terminal/index.js';
import * as vscode from '../../../../integrations/vscode/index.js';
import * as iterm from '../../../../integrations/iterm2/index.js';
import { UsageError, unknownSubcommand } from '../errors.js';

const NOT_WINDOWS = 'O Windows Terminal só existe no Windows. No Mac, use td theme export <nome> <arquivo>.itermcolors --iterm (iTerm2) ou --vscode.';

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
  // Valid themes are numbered in the same order as the interactive picker; `td theme set <n>` uses it.
  let n = 0;
  for (const t of listThemes(ctx.paths)) {
    const cur = t.name === ctx.config.theme.name ? ui.c.success(' ● atual') : '';
    const origin = t.origin === 'user' ? ui.c.muted(' [usuário]') : '';
    const bad = t.errors.length ? ui.c.error(` inválido: ${t.errors[0]}`) : '';
    const num = t.errors.length ? '   ' : ui.c.accent(String(++n).padStart(2) + ' ');
    ui.print(`  ${num} ${t.errors.length ? '' : swatches(t.theme, ui.mode)}  ${ui.c.bold(t.name.padEnd(17))} ${ui.c.muted(t.displayName ?? '')}${origin}${cur}${bad}`);
  }
  ui.print(`\n  ${ui.c.muted('Aplicar:')} ${ui.c.accent('td theme set <nome ou número>')}   ${ui.c.muted('Ver:')} ${ui.c.accent('td theme preview <nome>')}`);
}

/** "6" -> the 6th valid theme (same numbering as the list); anything else is a theme name. */
export function resolveThemeArg(arg, paths) {
  if (!/^\d+$/.test(String(arg))) return arg;
  const valid = listThemes(paths).filter((t) => !t.errors.length);
  const t = valid[Number(arg) - 1];
  if (!t) throw new UsageError(`não existe tema número ${arg} (use 1 a ${valid.length}; veja td theme list)`);
  return t.name;
}

function setTheme(nameOrNumber, flags, ctx) {
  const { ui } = ctx;
  const name = resolveThemeArg(nameOrNumber, ctx.paths);
  loadTheme(name, ctx.paths); // throws with a clear message if missing/invalid
  setConfigValue('theme.name', name, ctx.paths);
  ui.ok(`Tema ${ui.c.bold(name)} aplicado. A status line do Claude Code muda em alguns segundos.`);
  if (!flags.quietPreview) ui.print(preview(name, { ...ctx, config: { ...ctx.config, theme: { name, overrides: {} } } }).replace(/^/gm, '  '));
  if (flags.terminal || flags.wt) applyToTerminal(name, ctx);
}

/** --terminal (or --wt): the same colors in Windows Terminal, right away. */
/**
 * Home folder whose iTerm2 profile we may touch. Sandbox installs (a custom TD_DATA_HOME, as in
 * tests and CI) never touch the real one unless TD_ITERM_HOME says where to write.
 */
function itermHome(paths, env = process.env) {
  if (env.TD_ITERM_HOME) return path.resolve(env.TD_ITERM_HOME);
  const defaultData = path.join(os.homedir(), '.local', 'share', 'terminal-design');
  if (env.TD_DATA_HOME && path.resolve(env.TD_DATA_HOME) !== path.resolve(defaultData)) return null;
  return os.homedir();
}

function applyToMacTerminal(name, ctx) {
  const { ui } = ctx;
  const home = itermHome(ctx.paths);
  if (!home || !iterm.isItermInstalled({ home })) {
    ui.warn('No Mac, as cores do terminal mudam automaticamente só no iTerm2, e ele não foi encontrado. O Terminal do macOS não permite isso; use td theme export <tema> <arquivo>.itermcolors --iterm para o iTerm2.');
    return;
  }
  const r = iterm.applyItermProfile(loadTheme(name, ctx.paths), { home });
  ui.ok(`iTerm2: perfil "${iterm.PROFILE_NAME}" agora com as cores do tema. Abas que usam esse perfil mudam na hora.`);
  if (r.firstTime) ui.print(`  ${ui.c.muted(`Só na primeira vez: iTerm2 > Settings > Profiles > escolha "${iterm.PROFILE_NAME}" > Other Actions > Set as Default. Depois disso, cada troca de tema vale na hora.`)}`);
  ui.print(`  ${ui.c.muted('Para remover o perfil: td theme terminal off')}`);
}

function applyToTerminal(name, ctx) {
  const { ui } = ctx;
  if (process.platform === 'darwin') return applyToMacTerminal(name, ctx);
  if (process.platform !== 'win32') { ui.warn('No Linux, as cores do terminal não mudam automaticamente; só a status line mudou.'); return; }
  const r = wt.applyScheme(loadTheme(name, ctx.paths), ctx.paths);
  if (r.applied.length) {
    ui.ok(`Windows Terminal: esquema "${r.scheme}" aplicado em todos os perfis. As cores mudam na hora.`);
    ui.print(`  ${ui.c.muted('Para voltar às cores que você tinha: td theme terminal off (backup em ' + ctx.paths.backups + ')')}`);
    if (r.overridden.length) ui.warn(`estes perfis têm esquema próprio e não mudaram: ${r.overridden.join(', ')}`);
  }
  for (const s of r.skipped) ui.warn(`Windows Terminal: ${s.file} não foi alterado (${s.reason}). Escolha "${r.scheme}" em Configurações > Perfil > Aparência > Esquema de cores.`);
  if (!r.applied.length && !r.skipped.length) ui.warn(`Windows Terminal não encontrado. Os esquemas foram criados; se instalar depois, rode de novo com --terminal.`);
}

export default {
  id: 'theme',
  summary: 'Escolhe, lista, aplica, importa e exporta temas',
  usage: [
    'td theme                      seleção interativa',
    'td theme list                 lista os temas',
    'td theme set <nome|número> [--terminal]  aplica (com --terminal, também no Windows Terminal, na hora)',
    'td theme terminal off         devolve as cores que o Windows Terminal tinha antes',
    'td theme preview <nome>       mostra a status line com o tema',
    'td theme import <arquivo>     instala um tema .json [--force]',
    'td theme export <nome> <arq>  exporta (com personalizações) [--as <novo-nome>]',
    'td theme export <nome> <arq> --vscode   gera cores para o terminal do VS Code',
    'td theme export <nome> <arq>.itermcolors --iterm   gera um preset para o iTerm2 (Mac)',
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
        if (!a) throw new UsageError('informe o nome ou o número: td theme set <nome|número>');
        return setTheme(a, flags, ctx);
      case 'preview':
        ui.print(preview(a ? resolveThemeArg(a, ctx.paths) : ctx.config.theme.name, ctx));
        return;
      case 'import': {
        if (!a) throw new UsageError('informe o arquivo: td theme import <arquivo.json>');
        const r = importTheme(path.resolve(a), ctx.paths, { force: !!flags.force });
        ui.ok(`Tema ${ui.c.bold(r.name)} instalado em ${r.file}`);
        return;
      }
      case 'export': {
        if (!a || !b) throw new UsageError('uso: td theme export <nome> <arquivo.json>');
        const out = path.resolve(b);
        if (flags.iterm) {
          iterm.writeItermColors(loadTheme(a, ctx.paths), out);
          ui.ok(`Preset do iTerm2 salvo em ${out}`);
          ui.print(`  ${ui.c.muted('No iTerm2: Settings > Profiles > Colors > Color Presets > Import, e escolha o arquivo.')}`);
          return;
        }
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
      case 'terminal': {
        // td theme terminal off: Windows Terminal back to the colors it had before --terminal.
        if (a !== 'off') throw new UsageError('use td theme set <tema> --terminal para aplicar, ou td theme terminal off para desfazer');
        if (process.platform === 'darwin') {
          const home = itermHome(ctx.paths);
          if (home && iterm.removeItermProfile({ home })) ui.ok(`iTerm2: perfil "${iterm.PROFILE_NAME}" removido. Escolha outro perfil padrão em Settings > Profiles, se precisar.`);
          else ui.info('iTerm2: nada a desfazer.');
          return 0;
        }
        if (process.platform !== 'win32') { ui.info('Nada a desfazer neste sistema.'); return 0; }
        const r = wt.restoreScheme(ctx.paths);
        if (r.restored.length) ui.ok('Windows Terminal: cores de antes restauradas.');
        else ui.info('Windows Terminal: nada a desfazer (o td não tinha mudado as cores, ou você já trocou o esquema).');
        for (const s of r.skipped) ui.warn(`${s.file} não foi alterado (${s.reason}).`);
        return 0;
      }
      case 'wt': {
        if (process.platform !== 'win32') { ui.warn(NOT_WINDOWS); return 1; }
        if (!wt.isWindowsTerminalInstalled()) ui.warn('Windows Terminal não encontrado; o fragmento será criado mesmo assim.');
        const r = wt.syncSchemes(ctx.paths);
        ui.ok(`${r.count} esquemas de cores enviados ao Windows Terminal (${r.file})`);
        return;
      }
      default:
        throw unknownSubcommand('theme', sub);
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
