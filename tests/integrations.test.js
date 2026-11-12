import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isolate } from './helpers.js';
import { getPaths, readJson } from '../packages/core/src/index.js';
import * as cc from '../integrations/claude-code/index.js';
import * as wt from '../integrations/windows-terminal/index.js';

test('Claude Code install keeps other settings, backs up, and uninstall restores the previous status line', () => {
  isolate();
  const paths = getPaths();
  const file = cc.settingsFile(paths);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = { model: 'opus', statusLine: { type: 'command', command: 'bash ~/mine.sh' }, enabledPlugins: { a: true } };
  fs.writeFileSync(file, JSON.stringify(original));

  cc.install(paths);
  let s = readJson(file);
  assert.equal(s.model, 'opus');
  assert.deepEqual(s.enabledPlugins, { a: true });
  assert.ok(cc.isOurs(s.statusLine));
  assert.ok(cc.isOurs(s.subagentStatusLine));
  assert.match(s.statusLine.command, /bin\/td\.js" statusline --from=terminal-design$/);
  assert.ok(fs.readdirSync(paths.backups).some((f) => f.startsWith('claude-settings.json')));

  cc.install(paths); // reinstall must not lose the original
  cc.uninstall(paths);
  s = readJson(file);
  assert.deepEqual(s.statusLine, original.statusLine);
  assert.equal(s.subagentStatusLine, undefined);
  assert.equal(s.model, 'opus');
});

test('a broken settings.json is never overwritten', () => {
  isolate();
  const paths = getPaths();
  const file = cc.settingsFile(paths);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const broken = '{ "model": "opus", "permissions": { "allow": ["x"] }, }';
  fs.writeFileSync(file, broken);
  assert.throws(() => cc.install(paths), /nada foi alterado/);
  assert.equal(fs.readFileSync(file, 'utf8'), broken);
  assert.ok(cc.status(paths).error);
  assert.throws(() => cc.uninstall(paths), /nada foi alterado/);
});

test('reinstall remembers the newest foreign status line', () => {
  isolate();
  const paths = getPaths();
  const file = cc.settingsFile(paths);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ statusLine: { type: 'command', command: 'X' } }));
  cc.install(paths);
  const s = readJson(file);
  s.statusLine = { type: 'command', command: 'Y' }; // user switches to their own
  fs.writeFileSync(file, JSON.stringify(s));
  cc.install(paths);
  cc.uninstall(paths);
  assert.equal(readJson(file).statusLine.command, 'Y');
});

test('uninstall leaves a foreign status line alone', () => {
  isolate();
  const paths = getPaths();
  const file = cc.settingsFile(paths);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ statusLine: { type: 'command', command: 'other' } }));
  assert.equal(cc.uninstall(paths).changed, false);
  assert.equal(readJson(file).statusLine.command, 'other');
});

test('status line command: shell shim on macOS/Linux managed installs, node + launcher on Windows', () => {
  isolate();
  const paths = getPaths();
  const managed = { ...paths, appRoot: path.join(paths.versions, '0.1.1') };
  assert.match(cc.statusCommand(managed, false, 'darwin'), /^"[^"]+\/bin\/td" statusline --from=terminal-design$/);
  assert.match(cc.statusCommand(managed, true, 'linux'), /^"[^"]+\/bin\/td" statusline --subagent --from=terminal-design$/);
  assert.match(cc.statusCommand(managed, false, 'win32'), /^node "[^"]+\/launcher\.js" statusline --from=terminal-design$/);
  assert.match(cc.statusCommand(paths, false, 'darwin'), /^node "[^"]+\/bin\/td\.js" statusline/, 'dev clone uses node + td.js');
  assert.ok(cc.isOurs({ command: cc.statusCommand(managed, false, 'darwin') }));
});

test('iTerm2 preset is a valid plist with all 16 ANSI colors', async () => {
  isolate();
  const { toItermColors } = await import('../integrations/iterm2/index.js');
  const theme = (await import('../packages/themes/src/index.js')).loadTheme('nord');
  const xml = toItermColors(theme);
  assert.match(xml, /^<\?xml version="1\.0"/);
  for (let i = 0; i < 16; i++) assert.ok(xml.includes(`<key>Ansi ${i} Color</key>`), `Ansi ${i}`);
  assert.ok(xml.includes('<key>Background Color</key>'));
  // nord background #2e3440 -> red 46/255
  assert.ok(xml.includes(`<real>${(46 / 255).toFixed(6)}</real>`));
  assert.equal((xml.match(/<dict>/g) || []).length, 1 + 16 + 8);
});

test('Windows Terminal fragment contains every theme', () => {
  const root = isolate();
  const env = { LOCALAPPDATA: path.join(root, 'local') };
  const r = wt.syncSchemes(getPaths(), env);
  const frag = readJson(r.file);
  assert.equal(frag.schemes.length, 10);
  assert.ok(frag.schemes.every((s) => s.name.startsWith('TD ') && s.background && s.brightPurple));
  wt.removeSchemes(env);
  assert.equal(fs.existsSync(r.file), false);
});

// ---- /tema slash command ------------------------------------------------------

test('install writes /tema with our mark and the same td program as the status line; uninstall removes it', () => {
  isolate();
  const paths = getPaths();
  const r = cc.install(paths);
  const file = path.join(cc.commandsDir(paths), 'tema.md');
  assert.deepEqual(r.commands.written, [file, path.join(cc.commandsDir(paths), 'td.md')]);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes(cc.COMMAND_MARK));
  assert.ok(text.includes(`${cc.tdCommand(paths)} theme list --no-color`));
  assert.ok(text.includes(`${cc.tdCommand(paths)} theme set <argumento> --quiet-preview --no-color`));
  assert.ok(text.includes(`allowed-tools: Bash(${cc.tdCommand(paths)} theme:*)`), 'no permission prompt, theme only');
  assert.ok(text.includes('--terminal') && text.includes('theme terminal off'));
  assert.ok(!text.includes('theme preview'), 'preview is useless in the chat');
  assert.match(text, /^---\ndescription: /);
  assert.equal(cc.tdCommand(paths, 'win32'), cc.statusCommand(paths, false, 'win32').replace(' statusline --from=terminal-design', ''));
  const u = cc.uninstall(paths);
  assert.equal(u.commands.removed.length, 2);
  assert.equal(fs.existsSync(file), false);
});

test("a user's own tema.md is never overwritten nor removed", () => {
  isolate();
  const paths = getPaths();
  const file = path.join(cc.commandsDir(paths), 'tema.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'meu comando');
  const r = cc.install(paths);
  assert.deepEqual(r.commands.skipped, [file]);
  assert.ok(fs.existsSync(path.join(cc.commandsDir(paths), 'td.md')), 'the other command still installs');
  cc.uninstall(paths);
  assert.equal(fs.readFileSync(file, 'utf8'), 'meu comando');
});

test('ensureCommands (status line): adds /tema once for existing installs, respects a deletion, needs our status line', () => {
  isolate();
  const paths = getPaths();
  const file = path.join(cc.commandsDir(paths), 'tema.md');
  assert.equal(cc.ensureCommands(paths), false, 'no status line of ours: nothing');
  cc.install(paths);
  // Simulate an install made before /tema existed: no command, no record.
  cc.removeCommands(paths);
  assert.equal(cc.ensureCommands(paths), true);
  assert.ok(fs.existsSync(file));
  fs.rmSync(file);
  assert.equal(cc.ensureCommands(paths), false, 'already done for this version');
  assert.equal(fs.existsSync(file), false, 'user deletion respected');
});

// ---- Windows Terminal: apply / restore a scheme ----------------------------------

function wtSandbox(content) {
  const root = isolate();
  const file = path.join(root, 'wt', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 4));
  const env = { ...process.env, TD_WT_SETTINGS: file, TD_WT_FRAGMENTS_DIR: path.join(root, 'frag') };
  return { file, env, paths: getPaths() };
}

const nord = () => JSON.parse(fs.readFileSync(path.join(getPaths().builtinThemes, 'nord.json'), 'utf8'));

test('applyScheme sets the default scheme, keeps everything else, backs up; restore brings the old one back', () => {
  const { file, env, paths } = wtSandbox({ defaultProfile: '{x}', profiles: { defaults: { colorScheme: 'Campbell', font: { size: 11 } }, list: [{ name: 'PowerShell' }, { name: 'Ubuntu', colorScheme: 'One Half Dark' }] }, schemes: [] });
  const r = wt.applyScheme(nord(), paths, env);
  assert.deepEqual(r.applied, [file]);
  assert.equal(r.scheme, 'TD Nord');
  assert.deepEqual(r.overridden, ['Ubuntu']);
  let s = readJson(file);
  assert.equal(s.profiles.defaults.colorScheme, 'TD Nord');
  assert.deepEqual(s.profiles.defaults.font, { size: 11 });
  assert.equal(s.defaultProfile, '{x}');
  assert.ok(fs.existsSync(path.join(env.TD_WT_FRAGMENTS_DIR, 'terminal-design.json')), 'schemes written');
  assert.ok(fs.readdirSync(paths.backups).some((f) => f.startsWith('windows-terminal-settings.json')));
  wt.applyScheme(JSON.parse(fs.readFileSync(path.join(paths.builtinThemes, 'dracula.json'), 'utf8')), paths, env); // second theme
  assert.deepEqual(wt.restoreScheme(paths, env).restored, [file]);
  s = readJson(file);
  assert.equal(s.profiles.defaults.colorScheme, 'Campbell', 'the original, not the first TD scheme');
});

test('restore removes the key when there was none, and leaves a scheme the user picked afterwards', () => {
  const a = wtSandbox({ profiles: { list: [] } });
  wt.applyScheme(nord(), a.paths, a.env);
  wt.restoreScheme(a.paths, a.env);
  assert.equal(readJson(a.file).profiles.defaults.colorScheme, undefined);

  const b = wtSandbox({ profiles: { defaults: {} } });
  wt.applyScheme(nord(), b.paths, b.env);
  const s = readJson(b.file);
  s.profiles.defaults.colorScheme = 'Minha cor';
  fs.writeFileSync(b.file, JSON.stringify(s));
  assert.deepEqual(wt.restoreScheme(b.paths, b.env).restored, []);
  assert.equal(readJson(b.file).profiles.defaults.colorScheme, 'Minha cor');
});

test('a settings.json with comments or invalid JSON is never rewritten', () => {
  const withComments = '{\n  // meu comentário\n  "profiles": { "defaults": {} }\n}\n';
  const c = wtSandbox(withComments);
  const r = wt.applyScheme(nord(), c.paths, c.env);
  assert.equal(r.applied.length, 0);
  assert.match(r.skipped[0].reason, /comentários/);
  assert.equal(fs.readFileSync(c.file, 'utf8'), withComments);

  const urls = wtSandbox({ profiles: { defaults: { icon: 'https://x.y/z.png' } } }); // "//" inside a string is fine
  assert.equal(wt.applyScheme(nord(), urls.paths, urls.env).applied.length, 1);

  const broken = wtSandbox('{ "profiles": ');
  assert.match(wt.applyScheme(nord(), broken.paths, broken.env).skipped[0].reason, /JSON inválido/);
  assert.equal(fs.readFileSync(broken.file, 'utf8'), '{ "profiles": ');
});

test('sandbox installs (custom TD_DATA_HOME) never look at the real Windows Terminal settings', () => {
  assert.deepEqual(wt.settingsFiles({ TD_DATA_HOME: 'C:/tmp/x', LOCALAPPDATA: 'C:/Users/a/AppData/Local' }), []);
});

// ---- /td, update hint, onboarding tip -------------------------------------------

test('/td command: update, rollback, layout, doctor; permission only for those td subcommands', () => {
  isolate();
  const paths = getPaths();
  cc.install(paths);
  const text = fs.readFileSync(path.join(cc.commandsDir(paths), 'td.md'), 'utf8');
  const td = cc.tdCommand(paths);
  for (const s of ['update --yes', 'update --check', 'update --rollback --yes', 'config set cockpit.layout', 'doctor', 'config set cockpit.tips false']) {
    assert.ok(text.includes(`${td} ${s}`), s);
  }
  assert.ok(text.includes(`allowed-tools: Bash(${td} update:*), Bash(${td} config set cockpit.:*), Bash(${td} doctor:*), Bash(${td} version:*)`));
  assert.ok(text.includes(cc.COMMAND_MARK));
});

test('update button says /td atualizar only when our /td exists', () => {
  isolate();
  const paths = getPaths();
  assert.equal(cc.updateCommandHint(paths), null);
  cc.install(paths);
  assert.equal(cc.updateCommandHint(paths), '/td atualizar');
  const file = path.join(cc.commandsDir(paths), 'td.md');
  fs.writeFileSync(file, 'meu td');
  assert.equal(cc.updateCommandHint(paths), null, "a user's own td.md is not ours");
});

test('onboarding tip: first 3 days after /tema is installed, off with cockpit.tips=false, English locale', () => {
  isolate();
  const paths = getPaths();
  const cfg = { cockpit: { tips: true, locale: 'pt-BR' } };
  assert.equal(cc.onboardingTip(paths, cfg), null, 'no commands, no tip');
  cc.install(paths);
  const t0 = Date.parse('2026-11-12T12:00:00Z');
  assert.match(cc.onboardingTip(paths, cfg, t0), /\/tema muda as cores · \/td atualiza/);
  assert.ok(cc.onboardingTip(paths, cfg, t0 + 2 * 86400e3));
  assert.equal(cc.onboardingTip(paths, cfg, t0 + 4 * 86400e3), null, 'gone after 3 days');
  assert.equal(cc.onboardingTip(paths, { cockpit: { tips: false } }, t0), null);
  assert.match(cc.onboardingTip(paths, { cockpit: { locale: 'en' } }, t0), /^tip: /);
});

// ---- iTerm2 dynamic profile (macOS) ---------------------------------------------

test('iTerm2: one "Terminal-Design" dynamic profile, rewritten per theme, inherits Default, removed by off', async () => {
  const it = await import('../integrations/iterm2/index.js');
  const home = path.join(isolate(), 'home');
  assert.equal(it.isItermInstalled({ home, exists: () => false }), false);
  assert.equal(it.isItermInstalled({ home, exists: (p) => p === '/Applications/iTerm.app' }), true);
  const first = it.applyItermProfile(nord(), { home });
  assert.equal(first.firstTime, true);
  assert.equal(first.file, path.join(home, 'Library', 'Application Support', 'iTerm2', 'DynamicProfiles', 'terminal-design.json'));
  let doc = JSON.parse(fs.readFileSync(first.file, 'utf8'));
  assert.equal(doc.Profiles.length, 1);
  const p = doc.Profiles[0];
  assert.equal(p.Name, 'Terminal-Design');
  assert.equal(p.Guid, it.PROFILE_GUID);
  assert.equal(p['Dynamic Profile Parent Name'], 'Default');
  assert.equal(p['Background Color']['Color Space'], 'sRGB');
  for (let i = 0; i < 16; i++) assert.ok(p[`Ansi ${i} Color`], `ansi ${i}`);
  const nordBg = p['Background Color'];
  const second = it.applyItermProfile(JSON.parse(fs.readFileSync(path.join(getPaths().builtinThemes, 'dracula.json'), 'utf8')), { home });
  assert.equal(second.firstTime, false);
  doc = JSON.parse(fs.readFileSync(second.file, 'utf8'));
  assert.equal(doc.Profiles[0].Guid, it.PROFILE_GUID, 'same profile, new colors');
  assert.notDeepEqual(doc.Profiles[0]['Background Color'], nordBg);
  assert.equal(it.removeItermProfile({ home }), true);
  assert.equal(fs.existsSync(second.file), false);
  assert.equal(it.removeItermProfile({ home }), false);
});
