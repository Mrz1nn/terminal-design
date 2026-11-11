// `td voice`: offline dictation (whisper.cpp) with a global push-to-talk hotkey.
// All logic lives in apps/voice-engine; this file only maps flags and prints.
import readline from 'node:readline';
import {
  resolveOptions, createEngine, test, listDevices, status, doctor, planSetup, runSetup,
  formatBytes, parseHotkey, hotkeyWarnings, DEFAULT_HOTKEY, MODELS,
} from '../../../../apps/voice-engine/src/index.js';

const LANGS = ['pt', 'en', 'auto'];

/** CLI flags -> engine overrides (only the ones given). */
function overridesFrom(flags) {
  const o = {
    hotkey: typeof flags.hotkey === 'string' ? flags.hotkey : undefined,
    mode: flags.toggle ? 'toggle' : typeof flags.mode === 'string' ? flags.mode : undefined,
    language: typeof flags.language === 'string' ? flags.language : typeof flags.lang === 'string' ? flags.lang : undefined,
    model: typeof flags.model === 'string' ? flags.model : undefined,
    microphone: flags.mic !== undefined && flags.mic !== true ? String(flags.mic) : undefined,
    insertMode: flags.paste ? 'paste' : typeof flags.insert === 'string' ? flags.insert : undefined,
    whisperPath: typeof flags.whisper === 'string' ? flags.whisper : undefined,
    modelPath: typeof flags.modelPath === 'string' ? flags.modelPath : undefined,
    overlay: flags.overlay === false ? false : undefined,
    tray: flags.tray === false ? false : undefined,
    appendSpace: flags.space === false ? false : undefined,
  };
  if (o.language && !LANGS.includes(o.language)) throw new Error(`--language inválido: ${o.language} (use ${LANGS.join(', ')})`);
  if (o.mode && !['push-to-talk', 'toggle'].includes(o.mode)) throw new Error(`--mode inválido: ${o.mode} (push-to-talk ou toggle)`);
  if (o.model && !MODELS[o.model]) throw new Error(`--model inválido: ${o.model} (use ${Object.keys(MODELS).join(', ')})`);
  if (o.insertMode && !['type', 'paste'].includes(o.insertMode)) throw new Error(`--insert inválido: ${o.insertMode} (type ou paste)`);
  return o;
}

function progressPrinter(ui) {
  const tty = process.stdout.isTTY;
  let lastBucket = -1;
  return (label, received, total) => {
    const pct = total ? Math.floor((received / total) * 100) : null;
    const line = `  ${label}: ${formatBytes(received)}${total ? ` / ${formatBytes(total)} (${pct}%)` : ''}`;
    if (tty) {
      process.stdout.write(`\r${line}\x1b[K`);
      if (total && received >= total) process.stdout.write('\n');
    } else if (pct !== null && Math.floor(pct / 25) > lastBucket) {
      // Non-interactive output (logs, CI): one line per 25%.
      lastBucket = Math.floor(pct / 25);
      ui.print(line);
    }
  };
}

async function cmdSetup({ flags, ctx }) {
  const { ui } = ctx;
  const ov = overridesFrom(flags);
  ui.title('Configurar digitação por voz (whisper.cpp local)');
  const plan = await planSetup({
    config: ctx.config, model: ov.model, latest: !!flags.latest, force: !!flags.force, allowUnverified: !!flags.allowUnverified,
    whisperPath: ov.whisperPath, modelPath: ov.modelPath,
  });
  if (plan.items.length) {
    ui.print('  Será baixado:');
    for (const it of plan.items) {
      ui.print(`\n  ${ui.c.bold(it.label)}`);
      ui.table([
        ['origem', it.url],
        ['tamanho', formatBytes(it.size)],
        ['integridade', it.integrity],
        ['licença', it.license],
      ], { indent: 4 });
    }
    ui.print(`\n  ${ui.c.muted('Tudo roda offline depois disso. Nenhum áudio sai do computador.')}`);
  }
  const confirm = flags.yes ? async () => true : (q) => ui.confirm(q, false);
  if (!flags.yes && !process.stdin.isTTY && plan.items.length) {
    ui.warn('terminal não interativo: rode de novo com --yes para confirmar o download.');
    return 1;
  }
  const res = await runWithPlan(plan, { confirm, ui });
  if (res.cancelled) return 1;
  ui.ok('pronto. Teste com td voice test e depois inicie com td voice');
  return 0;
}

function runWithPlan(plan, { confirm, ui }) {
  return runSetup(plan, {
    confirm,
    log: { info: (s) => ui.info(s), ok: (s) => ui.ok(s), warn: (s) => ui.warn(s), progress: progressPrinter(ui) },
  });
}

async function cmdDevices({ ctx, opts }) {
  const { ui } = ctx;
  const devices = await listDevices(opts);
  ui.title('Microfones (waveIn)');
  if (!devices.length) {
    ui.warn('nenhum microfone encontrado');
    return 1;
  }
  ui.table([['default', 'padrão do Windows (Configurações > Som > Entrada)'], ...devices.map((d) => [String(d.index), `${d.name}  ${ui.c.muted(`${d.channels} canal(is)`)}`])]);
  ui.print(`\n  ${ui.c.muted('Escolha com: td config set voice.microphone <índice ou parte do nome>   (atual: ')}${opts.microphone}${ui.c.muted(')')}`);
  ui.print(`  ${ui.c.muted('Os nomes vêm do waveIn e são cortados em 31 caracteres pelo Windows.')}`);
  return 0;
}

async function cmdTest({ flags, ctx, opts }) {
  const { ui } = ctx;
  const seconds = Math.max(1, Math.min(60, Number(flags.seconds ?? 5) || 5));
  ui.title('Teste de voz (nada será digitado)');
  ui.info(`idioma ${opts.language}, modelo ${opts.model.name ?? opts.model.path}, microfone ${opts.microphone}`);
  const r = await test(opts, {
    seconds,
    onRecording: () => ui.print(`  ${ui.c.error('●')} gravando por ${seconds}s… fale agora`),
    onProcessing: (a) => ui.print(`  ${ui.c.warning('◌')} transcrevendo ${(a.durationMs / 1000).toFixed(1)}s de áudio…`),
  });
  if (r.silent) {
    ui.warn(`só silêncio (pico ${r.peak}/32767). Confira o microfone com td voice devices.`);
    return 1;
  }
  if (!r.text) {
    ui.warn(`nada reconhecido (${r.ms} ms). Texto bruto: ${JSON.stringify(r.raw.trim())}`);
    return 1;
  }
  ui.ok(`${ui.c.bold(r.text)}`);
  ui.print(`  ${ui.c.muted(`${r.ms} ms de transcrição · áudio apagado`)}`);
  return 0;
}

function cmdStatus({ ctx, opts, flags }) {
  const { ui } = ctx;
  const s = status(opts);
  if (flags.json) {
    ui.print(JSON.stringify(s, null, 2));
    return 0;
  }
  const yes = (b) => (b ? ui.c.success('sim') : ui.c.error('não'));
  ui.title('Voz: status');
  ui.table([
    ['whisper-cli', s.whisper.path ? `${s.whisper.path} ${ui.c.muted(`(${s.whisper.source})`)}` : ui.c.muted('não instalado')],
    ['instalado', yes(s.whisper.exists)],
    ['modelo', `${s.model.path ?? s.model.name}${s.model.size ? ui.c.muted(` (${formatBytes(s.model.size)})`) : ''}`],
    ['modelo presente', yes(s.model.exists)],
    ['atalho', `${s.hotkey} ${ui.c.muted(`(${s.mode})`)}`],
    ['idioma', s.language],
    ['microfone', String(s.microphone)],
    ['inserção', s.insertMode],
    ['dados', s.dataDir],
  ]);
  if (!s.whisper.exists || !s.model.exists) ui.print(`\n  ${ui.c.muted('Instale com:')} ${ui.c.accent('td voice setup')}`);
  return 0;
}

async function cmdStart({ ctx, opts }) {
  const { ui } = ctx;
  const hk = parseHotkey(opts.hotkey);
  const engine = createEngine(opts);
  const time = () => new Date().toLocaleTimeString('pt-BR');
  engine.on('status', ({ state, message }) => {
    if (state === 'recording') ui.print(`  ${ui.c.muted(time())} ${ui.c.error('● gravando')}`);
    else if (state === 'processing') ui.print(`  ${ui.c.muted(time())} ${ui.c.warning('◌ transcrevendo…')}`);
    else if (state === 'idle' && message) ui.print(`  ${ui.c.muted(time())} ${ui.c.muted(message)}`);
    else if (state === 'stopped' && message) ui.warn(message);
  });
  engine.on('transcript', ({ text, ms }) => ui.print(`  ${ui.c.muted(time())} ${ui.c.success('✓')} ${text} ${ui.c.muted(`(${ms} ms)`)}`));
  // R1/R2: insertion refused (focus moved, key held). The text is kept and can be copied.
  engine.on('blocked', ({ text, message }) => {
    ui.warn(message);
    ui.print(`    ${ui.c.muted('texto guardado:')} ${ui.c.fg(text)}`);
    ui.print(`    ${ui.c.muted('para copiar: aperte Enter neste terminal ou use o ícone da bandeja > Copiar última transcrição')}`);
  });
  engine.on('copied', ({ chars }) => ui.ok(`transcrição copiada (${chars} caractere(s)). Cole com Ctrl+V onde quiser.`));
  engine.on('warn', ({ message }) => ui.warn(message));
  engine.on('fail', ({ message }) => ui.error(message));
  if (process.env.TD_DEBUG) engine.on('debug', (l) => ui.print(ui.c.dim(`  [host] ${l}`)));

  ui.title('Digitação por voz');
  for (const w of hotkeyWarnings(hk)) ui.warn(w);
  ui.info('iniciando o host de voz (a primeira vez compila o helper, ~2s)…');
  const ready = await engine.start();
  const how = opts.mode === 'toggle' ? `aperte ${hk.label} para começar e de novo para parar` : `segure ${hk.label} enquanto fala e solte para digitar`;
  ui.ok(`pronto: ${how}`);
  ui.print(`  ${ui.c.muted(`microfone: ${ready.device} · idioma: ${opts.language} · modelo: ${opts.model.name ?? opts.model.path} · inserção: ${opts.insertMode}`)}`);
  ui.print(`  ${ui.c.muted('Ctrl+C aqui (ou "Sair" no ícone da bandeja) encerra. Nenhum áudio é guardado.')}`);
  ui.print(`  ${ui.c.muted('Se a janela mudar ou houver tecla pressionada, nada é digitado e o texto fica guardado para copiar.')}`);

  // Enter in this terminal copies the last transcription that was not inserted.
  let rl = null;
  if (process.stdin.isTTY) {
    rl = readline.createInterface({ input: process.stdin });
    rl.on('line', () => {
      if (!engine.copyLast()) ui.info('nenhuma transcrição guardada para copiar');
    });
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = async (code) => {
      if (done) return;
      done = true;
      rl?.close();
      process.off('SIGINT', onSig);
      process.off('SIGTERM', onSig);
      await engine.stop().catch(() => {});
      ui.info('digitação por voz encerrada');
      resolve(code);
    };
    const onSig = () => finish(0);
    process.on('SIGINT', onSig);
    process.on('SIGTERM', onSig);
    engine.on('exit', (code) => finish(code === 0 ? 0 : 1));
  });
}

export default {
  id: 'voice',
  summary: 'digitação por voz offline (whisper.cpp) com atalho global',
  usage: [
    `td voice                         inicia (segure ${DEFAULT_HOTKEY}, fale, solte)`,
    'td voice setup [--model=base] [--latest [--allow-unverified]] [--force] [--yes]',
    'td voice devices                 lista microfones',
    'td voice test [--seconds=5]      grava e mostra o texto, sem digitar',
    'td voice status [--json]',
    'opções: --toggle --hotkey=Ctrl+Shift+F8 --language=pt|en|auto --mic=<índice|nome>',
    '        --paste --no-space --no-overlay --no-tray --whisper=<exe> --model-path=<bin>',
  ],
  async run({ args, flags, ctx }) {
    const sub = args[0] ?? 'start';
    if (sub === 'setup') return cmdSetup({ flags, ctx });
    const opts = resolveOptions({ config: ctx.config, overrides: overridesFrom(flags) });
    if (process.platform !== 'win32' && sub !== 'status') {
      ctx.ui.error('a digitação por voz funciona só no Windows por enquanto');
      return 1;
    }
    switch (sub) {
      case 'start': return cmdStart({ ctx, opts });
      case 'devices': return cmdDevices({ ctx, opts });
      case 'test': return cmdTest({ flags, ctx, opts });
      case 'status': return cmdStatus({ ctx, opts, flags });
      default:
        ctx.ui.error(`subcomando desconhecido: td voice ${sub}`);
        ctx.ui.print('  use td voice --help');
        return 2;
    }
  },
  async doctor(ctx) {
    try {
      const opts = resolveOptions({ config: ctx.config });
      return await doctor(opts);
    } catch (e) {
      return [{ name: 'voz', ok: false, detail: e.message }];
    }
  },
};
