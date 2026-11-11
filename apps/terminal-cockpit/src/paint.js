import { fg, bold, RESET } from '../../../packages/core/src/index.js';

/** Theme-aware painter shared by every widget. */
export function makePainter(theme, mode) {
  const p = theme.palette;
  const color = (key, s) => {
    if (mode === 'none' || s === '' || s == null) return s ?? '';
    return `${fg(p[key] ?? key, mode)}${s}${RESET}`;
  };
  const strong = (key, s) => (mode === 'none' ? s : `${bold(mode)}${fg(p[key] ?? key, mode)}${s}${RESET}`);

  /** Severity color for a usage percentage, from theme thresholds. */
  const level = (pct) => {
    const t = theme.style.thresholds;
    if (pct >= t.error) return 'error';
    if (pct >= t.warning) return 'warning';
    return 'success';
  };

  /** Progress bar: filled part in the severity color, empty part muted. */
  const bar = (pct, width = theme.style.bar.width, key = level(pct)) => {
    const clamped = Math.max(0, Math.min(100, pct));
    let filled = Math.round((clamped / 100) * width);
    if (clamped > 0 && filled === 0) filled = 1;
    const { filled: f, empty: e } = theme.style.bar;
    return color(key, f.repeat(filled)) + color('muted', e.repeat(width - filled));
  };

  return { mode, color, strong, level, bar, sep: () => color('muted', theme.style.separator) };
}
