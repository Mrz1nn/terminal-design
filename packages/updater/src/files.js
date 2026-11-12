// Which files make up "the program". Shared by the local installer (scripts/install.ps1, scripts/install.sh)
// and the release packer (scripts/pack-release.js) so both ship exactly the same set.
import fs from 'node:fs';
import path from 'node:path';

/** Top-level folders copied into an install / release. Everything else is left out. */
export const PROGRAM_DIRS = ['bin', 'packages', 'apps', 'integrations', 'themes', 'scripts', 'docs'];

/** Top-level files copied besides package.json. */
const TOP_FILES = /^(package\.json|(README|LICENSE|LICENCE|NOTICE|CHANGELOG|SECURITY|THIRD[_-]PARTY[^/]*)(\.[a-z0-9.-]+)?)$/i;

/** Folder names skipped at any depth. */
export const EXCLUDED_DIRS = new Set([
  '.git', '.github', '.impeccable', '.vercel', '.claude', '.vscode', '.idea',
  'node_modules', 'tests', 'test', '__tests__', 'coverage', 'dist', '.cache', '__pycache__',
]);

const EXCLUDED_FILES = /(^\.env(\..*)?$|^\.DS_Store$|^Thumbs\.db$|\.log$|\.tmp$|\.bak$|~$)/i;

/** Sorted list of program files, as forward-slash paths relative to `root`. */
export function listProgramFiles(root) {
  const out = [];
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    const st = fs.lstatSync(full);
    if (st.isFile() && TOP_FILES.test(name)) out.push(name);
    else if (st.isDirectory() && PROGRAM_DIRS.includes(name)) walk(full, name, out);
  }
  if (!out.includes('package.json')) throw new Error(`package.json não encontrado em ${root}`);
  return out.sort();
}

function walk(dir, rel, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink()) continue; // never follow links out of the tree
    if (st.isDirectory()) {
      if (!EXCLUDED_DIRS.has(name)) walk(full, `${rel}/${name}`, out);
    } else if (st.isFile() && !EXCLUDED_FILES.test(name)) {
      out.push(`${rel}/${name}`);
    }
  }
}

/** Copy the program files of `srcRoot` into `destDir`. Returns the number of files. */
export function copyProgramFiles(srcRoot, destDir) {
  const files = listProgramFiles(srcRoot);
  for (const rel of files) {
    const to = path.join(destDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(srcRoot, ...rel.split('/')), to);
  }
  return files.length;
}
