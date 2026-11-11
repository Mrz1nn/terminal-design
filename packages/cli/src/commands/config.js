import { spawn } from 'node:child_process';
import { getAt, setConfigValue, loadUserConfig, parseValue, ensureConfig, validate, DEFAULTS } from '../../../config/src/index.js';
import { deepMerge } from '../../../core/src/index.js';

export default {
  id: 'config',
  summary: 'Mostra ou altera as configurações',
  usage: [
    'td config                  mostra a configuração efetiva',
    'td config get <chave>      ex.: td config get cockpit.layout',
    'td config set <chave> <v>  ex.: td config set cockpit.layout full',
    'td config path             caminho do arquivo',
    'td config edit             abre no editor padrão',
    'td config reset <chave>    volta a chave ao padrão',
  ],
  async run({ args, ctx }) {
    const [sub, key, ...rest] = args;
    const { ui, paths } = ctx;
    switch (sub) {
      case undefined:
      case 'show': {
        ui.title('Configuração');
        ui.print(`  ${ui.c.muted(paths.configFile)}\n`);
        ui.print(JSON.stringify(ctx.config, null, 2).replace(/^/gm, '  '));
        const problems = validate(deepMerge(structuredClone(DEFAULTS), loadUserConfig(paths)));
        for (const p of problems) ui.warn(`${p} (usando o padrão)`);
        return;
      }
      case 'get':
        if (!key) throw new Error('informe a chave');
        ui.print(JSON.stringify(getAt(ctx.config, key) ?? null, null, 2));
        return;
      case 'set': {
        if (!key || !rest.length) throw new Error('uso: td config set <chave> <valor>');
        if (getAt(DEFAULTS, key) === undefined && !key.startsWith('theme.overrides')) {
          throw new Error(`chave desconhecida: ${key}`);
        }
        setConfigValue(key, parseValue(rest.join(' ')), paths);
        ui.ok(`${key} = ${rest.join(' ')}`);
        return;
      }
      case 'reset': {
        if (!key) throw new Error('informe a chave');
        setConfigValue(key, structuredClone(getAt(DEFAULTS, key)), paths);
        ui.ok(`${key} voltou ao padrão`);
        return;
      }
      case 'path':
        ui.print(paths.configFile);
        return;
      case 'edit': {
        ensureConfig(paths);
        const editor = process.env.VISUAL || process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'vi');
        await new Promise((resolve) => spawn(editor, [paths.configFile], { stdio: 'inherit', shell: process.platform === 'win32' }).on('exit', resolve));
        const problems = validate(deepMerge(structuredClone(DEFAULTS), loadUserConfig(paths)));
        if (problems.length) problems.forEach((p) => ui.warn(p));
        else ui.ok('Configuração válida.');
        return;
      }
      default:
        throw new Error(`subcomando desconhecido: ${sub}`);
    }
  },
  doctor(ctx) {
    let problems;
    try {
      problems = validate(deepMerge(structuredClone(DEFAULTS), loadUserConfig(ctx.paths)));
    } catch (err) {
      return [{ name: 'Configuração', ok: false, detail: `arquivo ilegível: ${err.message}` }];
    }
    return [{ name: 'Configuração', ok: problems.length === 0, detail: problems.length ? problems.join('; ') : ctx.paths.configFile }];
  },
};
