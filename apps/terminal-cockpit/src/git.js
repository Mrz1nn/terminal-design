// Git state for the status line: one `git status --porcelain=v2 --branch` call, cached on disk
// per directory so frequent status line refreshes stay fast.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeFileAtomic } from '../../../packages/core/src/index.js';

export function parsePorcelainV2(out) {
  const st = { branch: null, detached: false, upstream: null, ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicts: 0 };
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const h = line.slice(14).trim();
      if (h === '(detached)') st.detached = true;
      else st.branch = h;
    } else if (line.startsWith('# branch.oid ') && st.detached) {
      st.branch = line.slice(13, 20);
    } else if (line.startsWith('# branch.upstream ')) {
      st.upstream = line.slice(18).trim();
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) { st.ahead = +m[1]; st.behind = +m[2]; }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = line.slice(2, 4);
      if (xy[0] !== '.') st.staged++;
      if (xy[1] !== '.') st.modified++;
    } else if (line.startsWith('u ')) {
      st.conflicts++;
    } else if (line.startsWith('? ')) {
      st.untracked++;
    }
  }
  st.dirty = st.staged + st.modified + st.untracked + st.conflicts;
  return st;
}

export function readGit(cwd, { cacheDir, cacheMs = 3000, now = Date.now() } = {}) {
  if (!cwd) return null;
  const key = crypto.createHash('sha1').update(cwd.toLowerCase()).digest('hex').slice(0, 16);
  const file = cacheDir ? path.join(cacheDir, `git-${key}.json`) : null;
  if (file && cacheMs > 0) {
    const hit = readJson(file, null);
    if (hit && now - hit.at < cacheMs) return hit.state;
  }
  let state = null;
  try {
    const out = execFileSync('git', ['--no-optional-locks', 'status', '--porcelain=v2', '--branch'], {
      cwd, encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
    });
    state = parsePorcelainV2(out);
  } catch {
    state = null; // not a repo, git missing or timeout
  }
  if (file) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      writeFileAtomic(file, JSON.stringify({ at: now, state }));
    } catch { /* cache is best effort */ }
  }
  return state;
}
