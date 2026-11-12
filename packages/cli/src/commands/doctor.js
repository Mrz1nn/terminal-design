import fs from 'node:fs';
import { registry } from '../../../core/src/index.js';

const [major, minor] = process.versions.node.split('.').map(Number);

export default {
  id: 'doctor',
  maxArgs: 0,
  summary: 'Diagnóstico da instalação',
  usage: ['td doctor', 'td doctor --json'],
  async run({ flags, ctx }) {
    const { ui } = ctx;
    const checks = [
      { name: 'Node.js', ok: major > 18 || (major === 18 && minor >= 17), detail: process.versions.node },
      { name: 'Modo', ok: true, detail: `${ctx.mode} (${ctx.paths.appRoot})` },
      { name: 'Pasta de config', ok: fs.existsSync(ctx.paths.configHome) ? true : null, detail: ctx.paths.configHome },
    ];
    for (const cmd of registry.list('command')) {
      if (typeof cmd.doctor !== 'function') continue;
      try {
        checks.push(...(await cmd.doctor(ctx)));
      } catch (err) {
        checks.push({ name: cmd.id, ok: false, detail: `diagnóstico falhou: ${err.message}` });
      }
    }
    if (flags.json) {
      ui.print(JSON.stringify(checks, null, 2));
    } else {
      ui.title(`td doctor ${ui.c.muted(ctx.version)}`);
      const icon = (ok) => (ok === true ? ui.c.success('✓') : ok === false ? ui.c.error('✗') : ui.c.warning('•'));
      const w = Math.max(...checks.map((c) => c.name.length));
      for (const c of checks) ui.print(`  ${icon(c.ok)} ${c.name.padEnd(w)}  ${ui.c.muted(c.detail ?? '')}`);
      const fails = checks.filter((c) => c.ok === false).length;
      const warns = checks.filter((c) => c.ok === null).length;
      ui.print('');
      if (fails) ui.error(`${fails} problema(s) encontrado(s).`);
      else ui.ok(`Tudo certo${warns ? ` (${warns} item(ns) opcional(is) pendente(s))` : ''}.`);
    }
    return checks.some((c) => c.ok === false) ? 1 : 0;
  },
};
