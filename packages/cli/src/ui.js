// Themed console output for `td` commands. Every command prints through this,
// so the active theme colors the whole CLI and NO_COLOR is respected everywhere.
import readline from 'node:readline';
import { fg, bold, dim, RESET, detectColorMode, visibleWidth } from '../../core/src/index.js';

export function createUi({ theme, colorMode = 'auto', stream = process.stdout, quiet = false } = {}) {
  const mode = stream.isTTY || process.env.TD_COLOR ? detectColorMode(colorMode) : 'none';
  const p = theme?.palette ?? {};
  const paint = (key) => (s) => (mode === 'none' ? String(s) : `${fg(p[key] ?? '#c0c0c0', mode)}${s}${RESET}`);
  const c = {
    primary: paint('primary'),
    secondary: paint('secondary'),
    accent: paint('accent'),
    success: paint('success'),
    warning: paint('warning'),
    error: paint('error'),
    muted: paint('muted'),
    fg: paint('foreground'),
    bold: (s) => (mode === 'none' ? String(s) : `${bold(mode)}${s}${RESET}`),
    dim: (s) => (mode === 'none' ? String(s) : `${dim(mode)}${s}${RESET}`),
  };
  const write = (s = '') => stream.write(`${s}\n`);
  const sym = mode === 'none' ? { ok: '[ok]', warn: '[!]', err: '[x]', info: '-' } : { ok: '✓', warn: '!', err: '✗', info: '›' };

  return {
    mode,
    c,
    print: write,
    title: (s) => write(`\n${c.bold(c.primary(s))}`),
    info: (s) => !quiet && write(`${c.accent(sym.info)} ${s}`),
    ok: (s) => write(`${c.success(sym.ok)} ${s}`),
    warn: (s) => write(`${c.warning(sym.warn)} ${s}`),
    error: (s) => process.stderr.write(`${c.error(sym.err)} ${s}\n`),
    /** Two-column key/value list. */
    table(rows, { indent = 2 } = {}) {
      const w = Math.max(0, ...rows.map(([k]) => visibleWidth(k)));
      for (const [k, v] of rows) write(`${' '.repeat(indent)}${c.muted(k.padEnd(w))}  ${v}`);
    },
    /** Yes/no prompt. Returns `def` when not interactive. `--yes` callers should skip it. */
    async confirm(question, def = false) {
      if (!process.stdin.isTTY) return def;
      const rl = readline.createInterface({ input: process.stdin, output: stream });
      const hint = def ? 'S/n' : 's/N';
      const answer = await new Promise((r) => rl.question(`${c.accent('?')} ${question} ${c.muted(`(${hint})`)} `, r));
      rl.close();
      const a = answer.trim().toLowerCase();
      if (!a) return def;
      return ['s', 'sim', 'y', 'yes'].includes(a);
    },
  };
}
