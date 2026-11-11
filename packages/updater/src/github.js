// GitHub Releases client. HTTPS only, timeouts, size limits, no personal data in requests.
import https from 'node:https';
import { parseSemver, compareSemver } from '../../core/src/index.js';

export const USER_AGENT = 'terminal-design-updater';
const API = 'https://api.github.com';

export class UpdateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * GET over HTTPS following redirects (HTTPS only). Resolves {status, headers, body: Buffer, url}.
 * This is the default `fetch` dependency; tests inject a fake with the same signature.
 */
export function httpsGet(url, { headers = {}, timeoutMs = 15000, maxBytes = 200 * 1024 * 1024, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new UpdateError('network', `URL inválida: ${url}`)); }
    if (u.protocol !== 'https:') return reject(new UpdateError('network', `somente HTTPS é permitido: ${url}`));
    const req = https.get(u, { headers: { 'User-Agent': USER_AGENT, ...headers }, timeout: timeoutMs }, (res) => {
      const status = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        if (maxRedirects <= 0) return reject(new UpdateError('network', 'redirecionamentos demais'));
        const next = new URL(res.headers.location, u);
        // Credentials never follow a redirect to another host (e.g. the asset CDN).
        const nextHeaders = { ...headers };
        if (next.host !== u.host) delete nextHeaders.Authorization;
        return resolve(httpsGet(next.href, { headers: nextHeaders, timeoutMs, maxBytes, maxRedirects: maxRedirects - 1 }));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(new UpdateError('network', 'download maior que o limite permitido')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks), url: u.href }));
      res.on('error', (e) => reject(new UpdateError('network', e.message)));
    });
    req.on('timeout', () => req.destroy(new UpdateError('network', `tempo esgotado ao acessar ${u.host}`)));
    req.on('error', (e) => reject(e instanceof UpdateError ? e : new UpdateError('network', `falha de rede (${e.code || e.message})`)));
  });
}

/** "owner/name" from config (update.repository) or package.json terminalDesign.repository. */
export function resolveRepo(config, pkg) {
  const repo = config?.update?.repository || pkg?.terminalDesign?.repository;
  if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new UpdateError('config', `repositório de atualização inválido: ${repo ?? '(vazio)'}`);
  return repo;
}

export function apiHeaders(env = process.env) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (env.GITHUB_TOKEN) h.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return h;
}

/** All published releases of `repo` (newest first as GitHub returns them). */
export async function fetchReleases(repo, { fetch = httpsGet, env = process.env, timeoutMs = 15000 } = {}) {
  const url = `${API}/repos/${repo}/releases?per_page=30`;
  let res;
  try {
    res = await fetch(url, { headers: apiHeaders(env), timeoutMs, maxBytes: 5 * 1024 * 1024 });
  } catch (err) {
    throw err instanceof UpdateError ? err : new UpdateError('network', `falha de rede: ${err.message}`);
  }
  if (res.status === 404) throw new UpdateError('not-found', `repositório ${repo} não encontrado no GitHub (ainda não publicado ou privado)`);
  if ((res.status === 403 || res.status === 429) && String(res.headers?.['x-ratelimit-remaining']) === '0') {
    throw new UpdateError('rate-limit', 'limite de consultas da API do GitHub atingido; tente mais tarde ou defina GITHUB_TOKEN');
  }
  if (res.status !== 200) throw new UpdateError('http', `GitHub respondeu ${res.status} ao listar releases`);
  let list;
  try { list = JSON.parse(res.body.toString('utf8')); } catch { throw new UpdateError('http', 'resposta inválida da API do GitHub'); }
  if (!Array.isArray(list)) throw new UpdateError('http', 'resposta inesperada da API do GitHub');
  return list;
}

export function releaseVersion(release) {
  const tag = String(release?.tag_name ?? '').trim();
  return parseSemver(tag) ? tag.replace(/^v/, '').replace(/\+.*$/, '') : null;
}

/**
 * Newest release for the channel. stable = no drafts, no prereleases (GitHub flag or semver
 * pre-release tag). prerelease = stable + prereleases. Returns {release, version} or null.
 */
export function selectRelease(releases, channel = 'stable') {
  let best = null;
  for (const r of releases ?? []) {
    if (!r || r.draft) continue;
    const version = releaseVersion(r);
    if (!version) continue;
    const isPre = !!r.prerelease || parseSemver(version).pre.length > 0;
    if (isPre && channel !== 'prerelease') continue;
    if (!best || compareSemver(version, best.version) > 0) best = { release: r, version };
  }
  return best;
}

/** Locate the program zip and the checksum file among the release assets. */
export function findAssets(release, version, meta = {}) {
  const zipName = (meta.releaseAsset || 'terminal-design-{version}.zip').replace('{version}', version);
  const sumName = meta.checksumAsset || 'SHA256SUMS.txt';
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const zip = assets.find((a) => a.name === zipName);
  const sums = assets.find((a) => a.name === sumName);
  return { zipName, sumName, zip: zip ?? null, sums: sums ?? null };
}

/** First lines of the release notes, markdown noise removed, for a terminal summary. */
export function summarizeNotes(body, maxLines = 8, maxWidth = 100) {
  const lines = String(body ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^#+\s*/, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`/g, '').trimEnd())
    .filter((l) => l.trim());
  const out = lines.slice(0, maxLines).map((l) => (l.length > maxWidth ? `${l.slice(0, maxWidth - 1)}…` : l));
  if (lines.length > maxLines) out.push(`… (+${lines.length - maxLines} linhas)`);
  return out;
}
