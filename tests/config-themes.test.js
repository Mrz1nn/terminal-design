import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isolate } from './helpers.js';
import { getPaths } from '../packages/core/src/index.js';
import { loadConfig, setConfigValue, validate, parseValue, ensureConfig, DEFAULTS } from '../packages/config/src/index.js';
import { listThemes, resolveTheme, validateTheme, importTheme, exportTheme, toWindowsTerminalScheme, toVSCodeColors, PALETTE_KEYS } from '../packages/themes/src/index.js';

const EXPECTED = ['catppuccin', 'dracula', 'gruvbox', 'midnight', 'monokai', 'nord', 'one-dark', 'solarized', 'terminal-classic', 'tokyo-night'];

test('all 10 built-in themes exist and are valid, with license metadata', () => {
  isolate();
  const themes = listThemes();
  assert.deepEqual(themes.map((t) => t.name), EXPECTED);
  for (const t of themes) {
    assert.deepEqual(t.errors, [], t.name);
    assert.ok(t.theme.license, `${t.name} license`);
    assert.ok(t.theme.source, `${t.name} source`);
  }
});

test('config: defaults, set, invalid values rejected, user file minimal', () => {
  const root = isolate();
  const paths = getPaths();
  assert.equal(loadConfig(paths).theme.name, DEFAULTS.theme.name);
  assert.equal(ensureConfig(paths), true);
  assert.equal(ensureConfig(paths), false, 'never overwrites');
  setConfigValue('cockpit.layout', 'full', paths);
  assert.equal(loadConfig(paths).cockpit.layout, 'full');
  assert.throws(() => setConfigValue('cockpit.layout', 'giant', paths));
  const onDisk = JSON.parse(fs.readFileSync(paths.configFile, 'utf8'));
  assert.equal(onDisk.voice, undefined, 'only changed keys are stored');
  // A hand-edited invalid value falls back to the default instead of crashing.
  fs.writeFileSync(paths.configFile, JSON.stringify({ color: { mode: 'rainbow' } }));
  assert.equal(loadConfig(paths).color.mode, 'auto');
  assert.ok(validate({ color: { mode: 'rainbow' } }).length);
  assert.ok(fs.readdirSync(path.join(root, 'data', 'backups')).length >= 1, 'backup made before writes');
});

test('config set refuses to rewrite a config.json with a syntax error', () => {
  isolate();
  const paths = getPaths();
  fs.mkdirSync(paths.configHome, { recursive: true });
  const broken = '{ "theme": { "name": "nord" }, "cockpit": { "layout": "full" }, }';
  fs.writeFileSync(paths.configFile, broken);
  assert.throws(() => setConfigValue('color.mode', 'none', paths), /nada foi alterado/);
  assert.equal(fs.readFileSync(paths.configFile, 'utf8'), broken);
});

test('parseValue', () => {
  assert.equal(parseValue('true'), true);
  assert.equal(parseValue('12'), 12);
  assert.deepEqual(parseValue('["a"]'), ['a']);
  assert.equal(parseValue('Ctrl+Alt+Space'), 'Ctrl+Alt+Space');
});

test('theme overrides, import/export roundtrip', () => {
  const root = isolate();
  const paths = getPaths();
  const t = resolveTheme({ theme: { name: 'nord', overrides: { palette: { primary: '#123456' }, style: { bar: { width: 12 } } } } }, paths);
  assert.equal(t.palette.primary, '#123456');
  assert.equal(t.style.bar.width, 12);
  assert.throws(() => resolveTheme({ theme: { name: 'nord', overrides: { palette: { primary: 'blue' } } } }, paths));

  const out = path.join(root, 'mine.json');
  exportTheme('dracula', out, { paths, as: 'meu-dracula' });
  const r = importTheme(out, paths);
  assert.equal(r.name, 'meu-dracula');
  assert.throws(() => importTheme(out, paths), /já existe/);
  assert.ok(listThemes(paths).some((x) => x.name === 'meu-dracula' && x.origin === 'user'));
});

test('validateTheme catches bad themes', () => {
  assert.ok(validateTheme({ name: 'Bad Name', palette: {} }).length > 1);
  const palette = Object.fromEntries(PALETTE_KEYS.map((k) => [k, '#000000']));
  assert.deepEqual(validateTheme({ name: 'ok', palette }), []);
  assert.ok(validateTheme({ name: 'ok', palette, style: { border: 'wavy' } }).length);
});

test('Windows Terminal and VS Code exports', () => {
  isolate();
  const theme = listThemes().find((t) => t.name === 'dracula').theme;
  const s = toWindowsTerminalScheme(theme);
  assert.equal(s.name, 'TD Dracula');
  assert.equal(s.purple, '#ff79c6');
  assert.equal(s.background, '#282a36');
  const v = toVSCodeColors(theme);
  assert.equal(v['terminal.ansiBrightWhite'], '#ffffff');
  assert.equal(Object.keys(v).filter((k) => k.startsWith('terminal.ansi')).length, 16);
});
