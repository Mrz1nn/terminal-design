// Tiny argv parser: positionals + --flag / --flag=value / --no-flag / -y.
export function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { positionals.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--no-')) { flags[camel(a.slice(5))] = false; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) flags[camel(a.slice(2, eq))] = a.slice(eq + 1);
      else flags[camel(a.slice(2))] = true;
      continue;
    }
    if (/^-[a-zA-Z]+$/.test(a)) {
      for (const c of a.slice(1)) flags[SHORT[c] || c] = true;
      continue;
    }
    positionals.push(a);
  }
  return { positionals, flags };
}

const SHORT = { y: 'yes', h: 'help', v: 'version', q: 'quiet' };

function camel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
