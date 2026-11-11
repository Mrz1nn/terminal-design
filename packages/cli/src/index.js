// `td` entry point. Commands are modules registered in the core registry:
//
//   export default {
//     id: 'theme',                 // first positional that selects it
//     kind: 'command',
//     summary: 'one line for td help',
//     usage: ['td theme list', ...],
//     async run({ args, flags, ctx }) -> exit code (number) | undefined (=0)
//     async doctor?(ctx) -> [{ name, ok: true|false|null, detail }]   // used by `td doctor`
//   }
//
// ctx = { paths, config, theme, ui, version, mode }
import { getPaths, installMode, currentVersion, registry } from '../../core/src/index.js';
import { loadConfig } from '../../config/src/index.js';
import { resolveTheme } from '../../themes/src/index.js';
import { parseArgs } from './args.js';
import { createUi } from './ui.js';
import builtins from './commands/index.js';

let loaded = false;
export function loadCommands() {
  if (loaded) return;
  for (const cmd of builtins) registry.register({ kind: 'command', ...cmd });
  loaded = true;
}

export function buildContext(flags = {}) {
  const paths = getPaths();
  const config = loadConfig(paths);
  let theme;
  try {
    theme = resolveTheme(config, paths);
  } catch {
    theme = resolveTheme({ theme: { name: 'midnight', overrides: {} } }, paths);
  }
  const ui = createUi({ theme, colorMode: flags.color === false ? 'none' : config.color.mode, quiet: !!flags.quiet });
  return { paths, config, theme, ui, version: currentVersion(), mode: installMode(paths) };
}

export async function main(argv = process.argv.slice(2)) {
  loadCommands();
  const { positionals, flags } = parseArgs(argv);
  let name = positionals[0];
  if (!name && flags.version) name = 'version';
  if (!name && flags.help) name = 'help';
  if (!name) name = 'dashboard';
  const cmd = registry.get('command', name);
  const ctx = buildContext(flags);
  if (!cmd) {
    ctx.ui.error(`comando desconhecido: ${name}`);
    ctx.ui.print(`  use ${ctx.ui.c.accent('td help')} para ver os comandos`);
    return 2;
  }
  if (flags.help && name !== 'help') {
    ctx.ui.title(`td ${cmd.id}`);
    ctx.ui.print(`  ${cmd.summary}\n`);
    for (const u of cmd.usage ?? []) ctx.ui.print(`  ${ctx.ui.c.accent(u)}`);
    return 0;
  }
  try {
    const code = await cmd.run({ args: positionals.slice(1), flags, ctx });
    return typeof code === 'number' ? code : 0;
  } catch (err) {
    ctx.ui.error(err?.message ?? String(err));
    if (process.env.TD_DEBUG) console.error(err);
    return 1;
  }
}
