import dashboard from './dashboard.js';
import help from './help.js';
import version from './version.js';
import theme from './theme.js';
import config from './config.js';
import doctor from './doctor.js';
import statusline from './statusline.js';
import claude from './claude.js';
import update from './update.js';
import uninstall from './uninstall.js';

// Order defines the order in `td help`.
export default [dashboard, help, version, update, theme, config, claude, doctor, statusline, uninstall];
