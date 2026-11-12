// td uninstall: removes integrations, the PATH entry and the installed program files.
// The user's configuration is kept unless they say otherwise (--purge or answering yes).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { removeInstall, removeUserPath } from '../../../updater/src/index.js';

async function loadIntegration(appRoot, name) {
  const file = path.join(appRoot, 'integrations', name, 'index.js');
  if (!fs.existsSync(file)) return null;
  try {
    return await import(pathToFileURL(file).href);
  } catch {
    return null;
  }
}

export default {
  id: 'uninstall',
  maxArgs: 0,
  summary: 'remove o Terminal-Design deste computador (a configuração fica, a menos que você peça)',
  usage: [
    'td uninstall               pergunta antes de cada passo',
    'td uninstall --yes         remove sem perguntar (mantém a configuração)',
    'td uninstall --keep-config mantém configuração e temas',
    'td uninstall --purge       apaga também configuração, temas e backups',
  ],
  async run({ flags, ctx }) {
    const { ui, paths } = ctx;
    ui.title('Desinstalar o Terminal-Design');
    ui.table([
      ['programa', paths.dataHome],
      ['configuração', paths.configHome],
      ['modo', ctx.mode === 'managed' ? 'instalado (managed)' : `clone git em ${paths.appRoot} (não será apagado)`],
    ]);
    ui.print('');
    if (!flags.yes && !(await ui.confirm('Remover o Terminal-Design deste computador?', false))) {
      ui.info('nada foi removido.');
      return 0;
    }

    let keepConfig = true;
    if (flags.purge) keepConfig = false;
    else if (flags.keepConfig || flags.yes) keepConfig = true;
    else keepConfig = !(await ui.confirm('Apagar também sua configuração, temas próprios e backups?', false));

    const cc = await loadIntegration(paths.appRoot, 'claude-code');
    if (cc && typeof cc.uninstall === 'function') {
      try {
        const r = await cc.uninstall(paths);
        if (r?.changed) ui.ok(`Claude Code: status line removida${r.restored ? ' (a anterior foi restaurada)' : ''}${r.backup ? `; backup em ${r.backup}` : ''}`);
        else ui.info('Claude Code: nenhuma integração do Terminal-Design encontrada.');
      } catch (err) {
        ui.warn(`Claude Code: não foi possível remover a integração (${err.message}). Rode td claude uninstall depois.`);
      }
    }
    const wt = await loadIntegration(paths.appRoot, 'windows-terminal');
    if (wt && typeof wt.removeSchemes === 'function') {
      try {
        // First give the terminal its own colors back, then remove our schemes.
        if (typeof wt.restoreScheme === 'function') {
          const r = wt.restoreScheme(paths);
          if (r.restored.length) ui.ok('Windows Terminal: cores de antes restauradas.');
        }
        await wt.removeSchemes();
        ui.ok('Windows Terminal: esquemas de cor do Terminal-Design removidos.');
      } catch (err) {
        ui.warn(`Windows Terminal: não foi possível remover os esquemas (${err.message}).`);
      }
    }

    {
      // Windows: user PATH in the registry. macOS/Linux: our marked block in the shell profiles
      // (each file is backed up first; nothing else in them is touched).
      const r = removeUserPath(paths.binDir, { backupDir: paths.backups });
      if (r.result === 'changed') ui.ok(`PATH: entrada do Terminal-Design removida${r.files?.length ? ` de ${r.files.join(', ')}` : ''}.`);
      else if (r.result === 'unchanged') ui.info('PATH: nada a remover.');
      else ui.warn(`PATH: não foi possível alterar (${r.detail || r.result}). Remova manualmente: ${paths.binDir}`);
    }

    const { removed, kept, deferred } = removeInstall(paths, { keepConfig, deferBin: process.platform === 'win32' });
    ui.ok(`${removed.length} itens removidos.`);
    for (const k of kept) ui.info(`mantido: ${k}`);
    for (const d of deferred) ui.info(`removido em instantes: ${d}`);
    if (ctx.mode !== 'managed') ui.info(`o clone git em ${paths.appRoot} não foi tocado; apague a pasta se quiser.`);
    ui.ok('Terminal-Design desinstalado. Abra um terminal novo para o PATH valer.');
    return 0;
  },
};
