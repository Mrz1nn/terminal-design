// Default configuration. User config (config.json) is deep-merged on top of this,
// so the user file only needs the keys they want to change.
export const DEFAULTS = Object.freeze({
  $schemaVersion: 1,
  theme: {
    name: 'midnight',
    // Per-key overrides applied on top of the selected theme, e.g.
    // { "palette": { "primary": "#ff8800" }, "style": { "bar": { "width": 12 } } }
    overrides: {},
  },
  color: {
    // auto | truecolor | 256 | 16 | none  (NO_COLOR env always disables color)
    mode: 'auto',
  },
  cockpit: {
    // compact = 1 line, cockpit = 2 lines, full = 3 lines, custom = use `rows`
    layout: 'cockpit',
    // Only used when layout is "custom": array of rows, each an array of widget ids.
    rows: null,
    // Widgets hidden everywhere, e.g. ["cost", "cache"]
    hide: [],
    // Show widgets whose data is unavailable as "n/d" instead of hiding them.
    showUnavailable: false,
    // Fallback width when Claude Code does not provide COLUMNS.
    maxWidth: 160,
    // Language for labels: pt-BR | en
    locale: 'pt-BR',
    git: {
      enabled: true,
      // Git status is cached for this many milliseconds to keep the status line fast.
      cacheMs: 3000,
    },
  },
  update: {
    // Never installs on its own. "notify" only shows that a new version exists.
    // off | notify
    auto: 'notify',
    // One anonymous GitHub API call per hour at most (limit is 60/hour per IP), so a new
    // release shows up within about an hour.
    checkIntervalHours: 1,
    channel: 'stable', // stable | prerelease
    repository: null, // null = value from package.json "terminalDesign.repository"
  },
  telemetry: false,
});
