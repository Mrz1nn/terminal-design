// Background update check started by getUpdateNotice(). Only refreshes the cache file.
// Anonymous on purpose: no GitHub token is read here (workerEnv() also strips it).
import { getPaths } from '../../core/src/index.js';
import { loadConfig } from '../../config/src/index.js';
import { checkForUpdates } from './notice.js';

const paths = getPaths();
const config = loadConfig(paths);
if (config.update.auto !== 'off') {
  await checkForUpdates({ paths, config, env: {} }).catch(() => {});
}
