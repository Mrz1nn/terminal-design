// td update: GitHub Releases updater with SHA-256 verification and rollback.
import fs from 'node:fs';
import {
  runUpdate,
  readCurrent,
  isValidVersionDir,
  listInstalledVersions,
  launcherFilesPresent,
  userPathHas,
  pathHas,
  profilesWithBlock,
  shimPath,
  readUpdateCache,
  getUpdateNotice,
} from '../../../updater/src/index.js';

export { getUpdateNotice };

function ago(ms) {
  const m = Math.round(ms / 60e3);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
}

function installHint(platform = process.platform) {
  return platform === 'win32' ? 'scripts\\install.ps1' : 'sh scripts/install.sh';
}

/**
 * PATH state. Windows: current session or HKCU registry. macOS/Linux: current session, or
 * our marked block in a shell profile (then a new terminal is all that is missing).
 */
export function pathCheck(paths, { platform = process.platform, env = process.env, home } = {}) {
  const inSession = pathHas(env.PATH, paths.binDir, env, platform);
  if (inSession) return { name: 'PATH', ok: true, detail: `${paths.binDir} está no PATH` };
  if (platform === 'win32') {
    const persisted = userPathHas(paths.binDir);
    return {
      name: 'PATH',
      ok: persisted === true ? true : null,
      detail: persisted === true
        ? `${paths.binDir} está no PATH do usuário (abra um terminal novo)`
        : persisted === false
          ? `${paths.binDir} não está no PATH do usuário (instalado com -NoPath? rode o instalador sem ele)`
          : 'não foi possível ler o PATH do usuário',
    };
  }
  const files = profilesWithBlock(home ? { home } : {});
  return files.length
    ? { name: 'PATH', ok: true, detail: `configurado em ${files.join(', ')} (abra um terminal novo)` }
    : { name: 'PATH', ok: null, detail: `${paths.binDir} não está no PATH (instalado com --no-path? rode sh scripts/install.sh sem ele)` };
}

/** Checks for `td doctor`. ok: true | false | null (= aviso / não se aplica). */
export function doctor(ctx) {
  const { paths, mode } = ctx;
  const managed = mode === 'managed';
  const checks = [{ name: 'modo de instalação', ok: true, detail: managed ? `instalado (${paths.dataHome})` : `clone git (${paths.appRoot}); atualize com git pull` }];

  const cur = readCurrent(paths);
  const hasInstall = fs.existsSync(paths.currentFile) || fs.existsSync(paths.versions);
  if (managed || hasInstall) {
    checks.push({
      name: 'current.json',
      ok: !!cur && isValidVersionDir(paths, cur.version),
      detail: cur ? `versão ${cur.version}${cur.previous ? `, anterior ${cur.previous}` : ''}` : `ausente ou inválido (reinstale com ${installHint()})`,
    });
    checks.push({ name: 'launcher', ok: launcherFilesPresent(paths), detail: launcherFilesPresent(paths) ? `${paths.launcher}, ${shimPath(paths)}` : `launcher.js, ${shimPath(paths)} ou marcador ausente (reinstale com ${installHint()})` });
    const versions = listInstalledVersions(paths);
    checks.push({ name: 'versões instaladas', ok: versions.length > 0, detail: versions.length ? versions.join(', ') : 'nenhuma' });
    checks.push(pathCheck(paths));
  } else {
    checks.push({ name: 'instalação gerenciada', ok: null, detail: `não instalada (opcional: ${installHint()})` });
  }

  if (ctx.config?.update?.auto === 'off') {
    checks.push({ name: 'verificação de atualização', ok: null, detail: 'desligada (update.auto = off)' });
  } else {
    const c = readUpdateCache(paths);
    let detail = 'nunca verificada (td update --check)';
    let ok = null;
    if (c?.checkedAt) {
      detail = `${ago(Date.now() - c.checkedAt)}`;
      if (c.error) detail += `: ${c.error.message}`;
      else if (c.latest) detail += `: última release ${c.latest.version}`;
      else detail += ': nenhuma release publicada';
      ok = c.error ? null : true;
    }
    checks.push({ name: 'última verificação', ok, detail });
  }
  return checks;
}

export default {
  id: 'update',
  maxArgs: 0,
  summary: 'atualiza o Terminal-Design pelas releases do GitHub (com checksum e rollback)',
  usage: [
    'td update              verifica, mostra as novidades e pergunta antes de instalar',
    'td update --check      só verifica, não instala nada',
    'td update --yes        instala sem perguntar',
    'td update --prerelease inclui versões de teste (ou update.channel = prerelease)',
    'td update --rollback   volta para a versão anterior',
  ],
  async run({ flags, ctx }) {
    return runUpdate({ ctx, flags });
  },
  doctor,
};
