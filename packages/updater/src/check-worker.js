// Background update check started by getUpdateNotice(). Only refreshes the cache file.
import { getPaths } from '../../core/src/index.js';
import { loadConfig } from '../../config/src/index.js';
import { checkForUpdates } from './notice.js';

const paths = getPaths();
const config = loadConfig(paths);
if (config.update.auto !== 'off') {
  await checkForUpdates({ paths, config }).catch(() => {});
}
