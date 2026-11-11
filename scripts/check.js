// Repository checks run in CI (`npm run lint`):
//  1. every .js file parses (node --check)
//  2. package.json has no runtime dependencies (license policy: zero third-party code at runtime)
//  3. every theme validates
//  4. no obvious secrets are committed
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { appRoot, readJson } from '../packages/core/src/index.js';
import { listThemes } from '../packages/themes/src/index.js';

const SKIP = new Set(['node_modules', '.git', 'dist', '.impeccable']);
const problems = [];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(appRoot);

for (const f of files.filter((x) => x.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    problems.push(`syntax: ${path.relative(appRoot, f)}\n${err.stderr}`);
  }
}

const pkg = readJson(path.join(appRoot, 'package.json'));
if (pkg.dependencies && Object.keys(pkg.dependencies).length) {
  problems.push(`package.json has runtime dependencies: ${Object.keys(pkg.dependencies).join(', ')} (review licenses and update THIRD_PARTY_NOTICES.md)`);
}

for (const t of listThemes({ builtinThemes: path.join(appRoot, 'themes'), userThemes: path.join(appRoot, '.no-user-themes') })) {
  if (t.errors.length) problems.push(`theme ${t.name}: ${t.errors.join('; ')}`);
  if (!t.theme?.license || !t.theme?.source) problems.push(`theme ${t.name}: missing license/source`);
}

const SECRET = /(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-ant-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9]{40,}|AKIA[0-9A-Z]{16})/;
for (const f of files.filter((x) => /\.(js|json|md|ps1|yml|yaml|txt)$/.test(x))) {
  if (SECRET.test(fs.readFileSync(f, 'utf8'))) problems.push(`possible secret in ${path.relative(appRoot, f)}`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`check ok: ${files.length} files`);
