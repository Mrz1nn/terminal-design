export default {
  id: 'version',
  summary: 'Mostra a versão instalada',
  usage: ['td version', 'td version --json'],
  run({ flags, ctx }) {
    if (flags.json) {
      ctx.ui.print(JSON.stringify({ version: ctx.version, mode: ctx.mode, node: process.versions.node }));
      return;
    }
    ctx.ui.print(`terminal-design ${ctx.version}`);
  },
};
