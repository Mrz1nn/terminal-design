// whisper.cpp CLI (whisper-cli.exe) invocation. Runs fully offline on the local CPU.
import os from 'node:os';
import { spawn } from 'node:child_process';

export const LANGUAGES = Object.freeze({ pt: 'pt', en: 'en', auto: 'auto' });

/** Sensible thread count: whisper.cpp scales well up to ~8 threads on desktop CPUs. */
export function defaultThreads(cpus = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length) {
  return Math.max(1, Math.min(8, cpus || 4));
}

/**
 * Pure: argument vector for whisper-cli.
 *   -nt  no timestamps (plain text on stdout)
 *   -np  no progress/system prints (only the transcript goes to stdout)
 */
export function buildWhisperArgs({ model, wav, language = 'pt', threads = defaultThreads(), prompt } = {}) {
  if (!model) throw new Error('caminho do modelo não informado');
  if (!wav) throw new Error('caminho do áudio não informado');
  const lang = LANGUAGES[language];
  if (!lang) throw new Error(`idioma inválido: ${language} (use pt, en ou auto)`);
  const args = ['-m', model, '-f', wav, '-l', lang, '-t', String(threads), '-nt', '-np'];
  // An initial prompt nudges punctuation/style; optional (voice.prompt, not set by default).
  if (prompt) args.push('--prompt', String(prompt));
  return args;
}

/**
 * Run whisper-cli and resolve with { text, ms }. Rejects with stderr tail on failure.
 * stdout is decoded as UTF-8 (whisper.cpp writes raw UTF-8 bytes regardless of code page).
 */
export function runWhisper(binary, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`não foi possível executar o whisper: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = Buffer.concat(out).toString('utf8');
      if (code !== 0) {
        const tail = Buffer.concat(err).toString('utf8').trim().split(/\r?\n/).slice(-3).join(' | ');
        reject(new Error(`whisper terminou com código ${code}${tail ? `: ${tail}` : ''}`));
        return;
      }
      resolve({ text, ms: Date.now() - started });
    });
  });
}
