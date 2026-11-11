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
      detail: cur ? `versão ${cur.version}${cur.previous ? `, anterior ${cur.previous}` : ''}` : 'ausente ou inválido (reinstale com scripts\\install.ps1)',
    });
    checks.push({ name: 'launcher', ok: launcherFilesPresent(paths), detail: launcherFilesPresent(paths) ? paths.launcher : 'launcher.js ou bin\\td.cmd ausente (reinstale)' });
    const versions = listInstalledVersions(paths);
    checks.push({ name: 'versões instaladas', ok: versions.length > 0, detail: versions.length ? versions.join(', ') : 'nenhuma' });
    if (process.platform === 'win32') {
      const inPath = pathHas(process.env.PATH, paths.binDir) ? true : userPathHas(paths.binDir);
      checks.push({
        name: 'PATH',
        ok: inPath === true ? true : null,
        detail: inPath === true
          ? `${paths.binDir} está no PATH`
          : inPath === false
            ? `${paths.binDir} não está no PATH do usuário (instalado com -NoPath? rode o instalador sem ele)`
            : 'não foi possível ler o PATH do usuário',
      });
    }
  } else {
    checks.push({ name: 'instalação gerenciada', ok: null, detail: 'não instalada (opcional: scripts\\install.ps1)' });
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
