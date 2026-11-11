# Digitação por voz (`td voice`)

Ditado offline para Windows. Você segura um atalho global, fala e solta, e o texto aparece na janela que estiver em foco: CMD, PowerShell, Windows Terminal, VS Code, navegador e assim por diante. A transcrição roda no seu computador com o [whisper.cpp](https://github.com/ggml-org/whisper.cpp). Nenhum áudio sai da máquina.

O módulo funciona sozinho, sem o cockpit. O código fica em `apps/voice-engine/`, e o comando `td voice` é só uma das formas de usá-lo.

## Requisitos

- Windows 10 1803 ou mais novo, ou Windows 11, em x64. Usa o `tar.exe` do sistema e o Windows PowerShell 5.1, que já vêm instalados.
- Node.js 18.17 ou mais novo.
- Um microfone.
- Nenhuma dependência npm, nenhum ffmpeg e nenhum Python.

## Instalação

```powershell
td voice setup                 # whisper.cpp + modelo "base" (padrão da config)
td voice setup --model=tiny    # modelo menor e mais rápido
td voice setup --latest        # usa a build mais nova do whisper.cpp em vez da fixada
td voice setup --force         # baixa de novo
td voice setup --yes           # confirma sem perguntar (scripts)
```

Antes de baixar qualquer coisa, o `setup` mostra a origem, o tamanho, o hash esperado e a licença de cada arquivo, e só segue depois que você confirmar. Em terminal não interativo ele não baixa nada sem `--yes`.

| Arquivo | Origem | Tamanho | Integridade |
|---|---|---|---|
| `whisper-bin-x64.zip` (build `b5454`, whisper.cpp v1.9.5, CPU) | `github.com/ggml-org/whisper.cpp/releases` | 8.5 MB | SHA-256 publicado pelo GitHub (`digest` do asset), fixado no código |
| `ggml-tiny.bin` | `huggingface.co/ggerganov/whisper.cpp` | 74 MB | SHA-1 `bd577a11…` |
| `ggml-base.bin` | idem | 141 MB | SHA-1 `46570746…` |
| `ggml-small.bin` | idem | 465 MB | SHA-1 `55356645…` |
| `ggml-medium.bin` | idem | 1.4 GB | SHA-1 `fd9727b6…` |

Os SHA-1 dos modelos vêm de `models/README.md` do whisper.cpp. Um download com hash ou tamanho errado é apagado e não é instalado. Com `--latest`, o hash vem da API do GitHub. Se uma release não publicar hash, o SHA-256 calculado no download fica registrado em `install.json` e o `setup` avisa.

Os arquivos ficam em `%LOCALAPPDATA%\TerminalDesign\voice\`:

```
voice\
  whisper\<build>\Release\whisper-cli.exe   (+ DLLs)
  models\ggml-<modelo>.bin
  cache\voice-host-<hash>.dll               helper C# compilado (recriado se apagado)
  tmp\                                      WAVs temporários, apagados após transcrever
  install.json                              versões e hashes verificados
```

### Usar um whisper.cpp ou modelo que você já tem

```powershell
td voice --whisper="D:\whisper\whisper-cli.exe" --model-path="D:\models\ggml-small.bin"
```

Para deixar fixo, use as chaves `voice.whisperPath` e `voice.modelPath` (abra o arquivo com `td config edit`). Também dá para usar a variável de ambiente `TD_WHISPER_CLI`. Para um modelo externo não há hash conhecido, então o `td doctor` mostra o caminho sem verificar.

## Uso

```powershell
td voice                 # inicia em primeiro plano; Ctrl+C encerra
td voice test            # grava 5 s e mostra o texto, sem digitar nada
td voice test --seconds=10
td voice devices         # lista os microfones
td voice status          # o que está instalado e a config efetiva (--json)
td doctor                # inclui as verificações de voz
```

Com `td voice` rodando:

- **push-to-talk** (padrão): segure `Ctrl+Alt+Space`, fale e solte. O texto é digitado assim que a transcrição termina.
- **toggle**: aperte o atalho para começar e de novo para parar (`--toggle` ou `voice.mode = "toggle"`).
- A gravação para sozinha em `voice.maxSeconds` (60 s por padrão).
- Gravações com menos de 0,3 s ou só com silêncio são descartadas sem chamar o whisper.

### Indicadores

- **Overlay**: uma faixa pequena acima da barra de tarefas mostra "● Gravando 3s" e depois "◌ Transcrevendo…". Ela nunca recebe foco, então o texto continua indo para a sua janela. Para desligar: `--no-overlay`.
- **Bandeja**: o ícone fica cinza quando está pronto, vermelho gravando e âmbar transcrevendo. O menu do ícone tem "Sair". Para desligar: `--no-tray`.
- **Console**: uma linha por evento, com o texto reconhecido e o tempo que levou.

### Configuração (`td config set voice.<chave> <valor>`)

| Chave | Padrão | Valores |
|---|---|---|
| `voice.hotkey` | `Ctrl+Alt+Space` | modificadores `Ctrl`, `Alt`, `Shift`, `Win` + uma tecla (`A`-`Z`, `0`-`9`, `F1`-`F24`, `Space`, `Enter`, `Tab`, `Insert`, `Home`, `End`, `PageUp`, `PageDown`, setas, `` ` ``, `Pause`, `ScrollLock`, `Numpad0-9`…). `F1`-`F24`, `Pause` e `ScrollLock` funcionam sozinhas. Uma letra sem modificador, ou só com Shift, é recusada porque atrapalharia a digitação. |
| `voice.mode` | `push-to-talk` | `push-to-talk`, `toggle` |
| `voice.language` | `pt` | `pt`, `en`, `auto` (o whisper detecta o idioma) |
| `voice.model` | `base` | `tiny`, `base`, `small`, `medium` (todos multilíngues) |
| `voice.microphone` | `default` | `default` (o padrão do Windows), o índice mostrado em `td voice devices` ou parte do nome |
| `voice.insertMode` | `type` | `type` (teclas Unicode simuladas) ou `paste` (área de transferência + Ctrl+V) |
| `voice.appendSpace` | `true` | coloca um espaço depois de cada trecho, para emendar frases |
| `voice.maxSeconds` | `60` | 1 a 600 |

Para mudar só uma vez, sem alterar a config, use os flags `--hotkey=`, `--toggle`, `--language=`, `--model=`, `--mic=`, `--paste`, `--no-space`.

Na prática, o `tiny` responde em cerca de 1 s e erra mais; o `base` é um bom equilíbrio para português; `small` e `medium` são mais precisos, mas bem mais lentos na CPU.

## Privacidade

- O processamento é 100% local. O áudio vai do microfone para um WAV temporário em `voice\tmp\`, o `whisper-cli.exe` lê esse arquivo e o WAV é apagado logo depois, inclusive quando a transcrição falha. Na inicialização e no encerramento, qualquer WAV que tenha sobrado de uma queda é apagado.
- Nenhum áudio e nenhum texto é guardado em log ou enviado para algum lugar. O texto reconhecido só aparece no console do `td voice`.
- O único acesso à rede é o `td voice setup`, que baixa os arquivos listados acima, sempre com confirmação.
- No modo `paste`, o texto passa pela área de transferência e o conteúdo de texto anterior é restaurado em seguida.

## Como funciona

```
td voice (Node)                         voice-host.ps1 -> voice-host.cs (Add-Type, .NET Framework)
  engine.js  <-- JSON lines (stdout) --   RegisterHotKey + GetAsyncKeyState (soltar = parar)
             --- JSON lines (stdin)  -->  waveIn 16 kHz / mono / 16 bit -> WAV
  whisper.js -> whisper-cli.exe -l pt     SendInput KEYEVENTF_UNICODE  |  Clipboard + Ctrl+V
  text.js (limpeza)                       NotifyIcon + overlay WS_EX_NOACTIVATE
```

- O host manda os eventos `ready`, `recording`, `audio {path, durationMs, peak}`, `cancelled`, `typed`, `warn`, `error` e `quit`. O Node responde com `type {text}`, `state {state, message}` e `quit`. O protocolo completo está em `apps/voice-engine/src/protocol.js`.
- Se o Node morrer, o stdin do host fecha e ele sai sozinho. Nada fica rodando para trás.
- O helper C# é compilado na primeira execução, o que leva uns 2 s, e fica em cache por hash do código-fonte.
- Antes de digitar, o host espera você soltar Ctrl, Alt, Shift e Win. Sem isso, "olá" com Ctrl+Alt ainda apertados viraria atalhos ou caracteres AltGr. Ao disparar um atalho que tem Alt ou Win, o host injeta uma tecla neutra (vk 0xE8, o mesmo truque do AutoHotkey), para que soltar o Alt não abra o menu da janela.

### API programática

```js
import { resolveOptions, createEngine, test, listDevices, setup, status, doctor } from './apps/voice-engine/src/index.js';

const opts = resolveOptions({ config, overrides: { language: 'en' } });
const engine = createEngine(opts);
engine.on('transcript', ({ text }) => console.log(text));
await engine.start();          // resolve quando o atalho está registrado
// ...
await engine.stop();

const { text } = await test(opts, { seconds: 5 }); // grava e transcreve, sem digitar
```

Também são exportadas as funções puras `parseHotkey`, `cleanTranscript`, `buildWhisperArgs`, `parseLine`, `createLineDecoder` e `encodeCommand`.

## Limitações conhecidas

- **Janelas elevadas (administrador)**: o Windows (UIPI) descarta em silêncio o `SendInput` que um processo comum manda para uma janela elevada. Se o terminal em foco estiver rodando como administrador, rode o `td voice` também como administrador. O host avisa quando detecta esse caso, mas a detecção é por melhor esforço.
- **A tela de login, o UAC e alguns jogos ou anti-cheat** não aceitam entrada simulada.
- **O texto vai para a janela que está em foco no momento de digitar**, não para a que estava em foco quando você apertou o atalho. Se você trocar de janela durante a transcrição, o texto vai para a nova.
- **O atalho é exclusivo**: se outro programa já registrou a combinação, o `td voice` avisa e não inicia. Escolha outra com `--hotkey=`. A mesma combinação também deixa de chegar aos outros programas enquanto o `td voice` estiver rodando.
- **Nomes de microfone**: a API waveIn corta os nomes em 31 caracteres e os índices podem mudar quando você conecta ou desconecta um dispositivo. Prefira escolher por parte do nome. Com `default`, o que vale é o microfone padrão de *Configurações > Som > Entrada*. Se você mudar o microfone padrão enquanto o `td voice` estiver rodando, a mudança vale a partir da próxima gravação.
- **Modo `paste`**: só texto é restaurado na área de transferência. Imagens ou arquivos copiados antes se perdem. Alguns programas usam outro atalho para colar (no CMD clássico antigo, por exemplo, Ctrl+V depende de "Usar Ctrl+Shift+C/V").
- **Só CPU**: a build baixada é a `whisper-bin-x64` (CPU, sem BLAS). Para usar GPU (CUDA), baixe você mesmo um `whisper-cli.exe` com CUDA e aponte para ele com `--whisper=`.
- **O modelo é recarregado a cada trecho**, porque cada transcrição chama o `whisper-cli` de novo. Com o `base`, isso custa uma fração de segundo.
- **Alucinações**: em ruído ou silêncio o Whisper às vezes inventa frases ("Legendas pela comunidade Amara.org"). Frases conhecidas são descartadas quando são o texto inteiro, e áudio muito baixo nem chega a ser transcrito.
- **Só Windows**: em Linux e macOS, `td voice status` funciona e os outros subcomandos avisam que não há suporte.

## Licenças

- **whisper.cpp**: MIT, © The ggml authors. É baixado como binário oficial das releases de `ggml-org/whisper.cpp` e não vem embutido neste repositório.
- **Modelos ggml**: são pesos do [OpenAI Whisper](https://github.com/openai/whisper) (MIT), convertidos para ggml por Georgi Gerganov e distribuídos em `huggingface.co/ggerganov/whisper.cpp`.
- **O código deste módulo**: MIT, como o resto do Terminal-Design.
