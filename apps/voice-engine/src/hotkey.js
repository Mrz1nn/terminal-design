// Hotkey string ("Ctrl+Shift+F9") -> RegisterHotKey modifiers + virtual-key code.
// Pure logic, no Win32 here: the native host receives the two numbers.

export const MOD = Object.freeze({ ALT: 0x1, CTRL: 0x2, SHIFT: 0x4, WIN: 0x8 });

/**
 * Default push-to-talk hotkey.
 *
 * Why not Ctrl+Alt+Space (the first default): Windows reports AltGr as Ctrl+Alt. On ABNT2 and
 * other layouts that type characters with AltGr ("/", "?", "°"...), any Ctrl+Alt+<key> hotkey can
 * fire while the user is typing (AltGr+Q then Space with AltGr still down).
 * Ctrl+Shift+F9 has no Alt, so AltGr can never trigger it. F9 types nothing. No default binding
 * was found in CMD, PowerShell, Windows Terminal or the Windows shell. A program that already
 * registered it globally makes `td voice` fail with a clear message.
 */
export const DEFAULT_HOTKEY = 'Ctrl+Shift+F9';

const MOD_ALIASES = {
  ctrl: 'CTRL', control: 'CTRL', ctl: 'CTRL',
  alt: 'ALT', menu: 'ALT',
  shift: 'SHIFT',
  win: 'WIN', windows: 'WIN', super: 'WIN', meta: 'WIN', cmd: 'WIN',
};

const MOD_LABEL = { CTRL: 'Ctrl', ALT: 'Alt', SHIFT: 'Shift', WIN: 'Win' };
const MOD_ORDER = ['CTRL', 'ALT', 'SHIFT', 'WIN'];

// Named keys -> [VK code, display label]. Letters, digits and F1-F24 are computed below.
const NAMED = {
  space: [0x20, 'Space'], spacebar: [0x20, 'Space'],
  enter: [0x0d, 'Enter'], return: [0x0d, 'Enter'],
  tab: [0x09, 'Tab'],
  backspace: [0x08, 'Backspace'],
  esc: [0x1b, 'Esc'], escape: [0x1b, 'Esc'],
  pause: [0x13, 'Pause'], break: [0x13, 'Pause'],
  capslock: [0x14, 'CapsLock'],
  scrolllock: [0x91, 'ScrollLock'],
  insert: [0x2d, 'Insert'], ins: [0x2d, 'Insert'],
  delete: [0x2e, 'Delete'], del: [0x2e, 'Delete'],
  home: [0x24, 'Home'], end: [0x23, 'End'],
  pageup: [0x21, 'PageUp'], pgup: [0x21, 'PageUp'],
  pagedown: [0x22, 'PageDown'], pgdn: [0x22, 'PageDown'],
  left: [0x25, 'Left'], up: [0x26, 'Up'], right: [0x27, 'Right'], down: [0x28, 'Down'],
  printscreen: [0x2c, 'PrintScreen'],
  '`': [0xc0, '`'], backquote: [0xc0, '`'], grave: [0xc0, '`'],
  '-': [0xbd, '-'], minus: [0xbd, '-'],
  '=': [0xbb, '='], equals: [0xbb, '='], plus: [0xbb, '='],
  ',': [0xbc, ','], comma: [0xbc, ','],
  '.': [0xbe, '.'], period: [0xbe, '.'],
  ';': [0xba, ';'], semicolon: [0xba, ';'],
  '/': [0xbf, '/'], slash: [0xbf, '/'],
  '\\': [0xdc, '\\'], backslash: [0xdc, '\\'],
  '[': [0xdb, '['], ']': [0xdd, ']'],
  "'": [0xde, "'"], quote: [0xde, "'"],
  numpad0: [0x60, 'Numpad0'], numpad1: [0x61, 'Numpad1'], numpad2: [0x62, 'Numpad2'],
  numpad3: [0x63, 'Numpad3'], numpad4: [0x64, 'Numpad4'], numpad5: [0x65, 'Numpad5'],
  numpad6: [0x66, 'Numpad6'], numpad7: [0x67, 'Numpad7'], numpad8: [0x68, 'Numpad8'],
  numpad9: [0x69, 'Numpad9'],
};

// Keys that are safe as a hotkey without any modifier (they do nothing useful when typing).
const SOLO_OK = new Set([0x13, 0x91, 0x2c]);

function resolveKey(token) {
  const t = token.toLowerCase();
  if (NAMED[t]) return NAMED[t];
  if (/^[a-z]$/.test(t)) return [t.toUpperCase().charCodeAt(0), t.toUpperCase()];
  if (/^[0-9]$/.test(t)) return [t.charCodeAt(0), t];
  const f = /^f([1-9]|1[0-9]|2[0-4])$/.exec(t);
  if (f) return [0x6f + Number(f[1]), `F${f[1]}`];
  return null;
}

/**
 * Parse "Ctrl+Alt+Space" (case-insensitive, "+" separated; use "Equals"/"Plus" for the = key).
 * Returns { modifiers, vk, label, keys: ['CTRL','ALT'] }. Throws with a pt-BR message.
 */
export function parseHotkey(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('atalho vazio');
  const tokens = raw.split(/\s*[+]\s*/).filter(Boolean);
  if (tokens.length === 0) throw new Error(`atalho inválido: "${raw}"`);
  const mods = new Set();
  let key = null;
  for (const tok of tokens) {
    const m = MOD_ALIASES[tok.toLowerCase()];
    if (m) {
      if (mods.has(m)) throw new Error(`modificador repetido em "${raw}": ${tok}`);
      mods.add(m);
      continue;
    }
    if (key) throw new Error(`atalho "${raw}" tem mais de uma tecla principal`);
    key = resolveKey(tok);
    if (!key) throw new Error(`tecla desconhecida no atalho: "${tok}"`);
  }
  if (!key) throw new Error(`atalho "${raw}" precisa de uma tecla principal (ex.: ${DEFAULT_HOTKEY})`);
  const [vk, keyLabel] = key;
  const isFn = vk >= 0x70 && vk <= 0x87;
  if (mods.size === 0 && !isFn && !SOLO_OK.has(vk)) {
    throw new Error(`atalho "${raw}" sem modificador atrapalharia a digitação; use Ctrl/Alt/Shift/Win ou F1-F24`);
  }
  if (mods.size === 1 && mods.has('SHIFT') && !isFn) {
    throw new Error(`Shift sozinho com "${keyLabel}" atrapalharia a digitação; adicione Ctrl ou Alt`);
  }
  let modifiers = 0;
  for (const m of mods) modifiers |= MOD[m];
  const ordered = MOD_ORDER.filter((m) => mods.has(m));
  return { modifiers, vk, label: [...ordered.map((m) => MOD_LABEL[m]), keyLabel].join('+'), keys: ordered };
}

/**
 * Non-fatal warnings for a parsed hotkey (shown by `td voice` and `td doctor`).
 * Ctrl+Alt (without Win) + a key that types something collides with AltGr on ABNT2-like layouts.
 * The host also ignores the hotkey while AltGr (Right Alt) is down, but warn anyway.
 */
export function hotkeyWarnings(hk) {
  const warnings = [];
  const ctrlAlt = (hk.modifiers & (MOD.CTRL | MOD.ALT)) === (MOD.CTRL | MOD.ALT) && !(hk.modifiers & MOD.WIN);
  const isFn = hk.vk >= 0x70 && hk.vk <= 0x87;
  if (ctrlAlt && !isFn) {
    warnings.push(`${hk.label}: no teclado ABNT2, AltGr equivale a Ctrl+Alt. O atalho é ignorado enquanto o AltGr está pressionado, mas é melhor usar algo como ${DEFAULT_HOTKEY}.`);
  }
  return warnings;
}
