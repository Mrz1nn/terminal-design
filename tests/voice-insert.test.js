// Runs the C# insertion-safety tests (tests/fixtures/VoiceInsertTests.cs) against the real
// voice-host.cs source. They use a fake input environment: nothing is typed into real windows,
// the real clipboard is never touched, no hotkey is registered and no audio is recorded or played.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostCs = path.join(root, 'apps', 'voice-engine', 'native', 'voice-host.cs');
const testsCs = path.join(root, 'tests', 'fixtures', 'VoiceInsertTests.cs');

function runCsharpTests() {
  const q = (p) => `'${p.replace(/'/g, "''")}'`;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `Add-Type -Path ${q(hostCs)},${q(testsCs)} -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions`,
    '[Console]::Out.Write([TerminalDesign.Voice.Tests.InsertTests]::RunAll())',
  ].join('; ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 120000,
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'psmodulepath')),
  });
  if (r.status !== 0) throw new Error(`compilação/execução falhou:\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout.trim());
}

const results = process.platform === 'win32' ? runCsharpTests() : [];

test('voice host insertion tests ran', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  assert.ok(results.length >= 20, `only ${results.length} results`);
});

for (const r of results) {
  test(`[host] ${r.name}`, () => {
    assert.equal(r.ok, true, r.detail);
  });
}
