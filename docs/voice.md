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
td voice setup --latest        # usa a build mais nova do whisper.cpp em vez da fixada (exige digest publicado)
td voice setup --latest --allow-unverified   # aceita build sem hash publicado (por sua conta e risco)
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

Os SHA-1 dos modelos vêm de `models/README.md` do whisper.cpp. Um download com hash ou tamanho errado é apagado e não é instalado. Com `--latest`, o hash vem da API do GitHub (o `digest` do asset). Se essa build não publicar hash, o `setup` **se recusa** a instalar, porque o binário seria executado a cada ditado sem nenhuma verificação. Só com `--allow-unverified` explícito ele instala mesmo assim. Nesse caso, o SHA-256 calculado no download fica registrado em `install.json` e o `setup` mostra o aviso "NÃO VERIFICADO".

Depois de extrair o zip, o `setup` apaga tudo o que o `whisper-cli.exe` não usa: os programas de exemplo (`whisper-stream`, `whisper-command`, `whisper-talk-llama`, `wchess`, `whisper-server`, `parakeet-*`), os testes e as DLLs que só eles carregam (`SDL2.dll`, `llama.dll`, `parakeet.dll`). Ficam apenas:

| Arquivo | O que é | Licença |
|---|---|---|
| `whisper-cli.exe`, `whisper.dll` | whisper.cpp | MIT, © The ggml authors |
| `ggml.dll`, `ggml-base.dll` | biblioteca ggml | MIT, © The ggml authors |
| `ggml-cpu-{x64,sse42,sandybridge,haswell,skylakex,icelake,cascadelake,cannonlake,alderlake}.dll` | backends de CPU do ggml; o ggml escolhe em tempo de execução o que combina com o seu processador | MIT, © The ggml authors |

O zip original da build `b5454` traz ainda `SDL2.dll` (licença zlib, usada só pelos exemplos de captura em tempo real). Ela é removida na instalação e nunca é carregada pelo `td voice`.

O `whisper-cli.exe` e as DLLs dependem do **Microsoft Visual C++ 2015-2022 Redistributable (x64)** (`MSVCP140.dll`, `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll`), que não vem no zip. A maioria dos PCs com Windows já tem esse pacote instalado. Se o `td doctor` mostrar "whisper.cpp não executa (faltam DLLs?)", instale o pacote em <https://aka.ms/vs/17/release/vc_redist.x64.exe>, distribuído pela Microsoft sob os termos de licença dela.

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

- **push-to-talk** (padrão): segure `Ctrl+Shift+F9`, fale e solte. O texto é digitado assim que a transcrição termina, na janela que estava em foco quando você começou a falar.
- **toggle**: aperte o atalho para começar e de novo para parar (`--toggle` ou `voice.mode = "toggle"`).
- A gravação para sozinha em `voice.maxSeconds` (60 s por padrão).
- Gravações com menos de 0,3 s ou só com silêncio são descartadas sem chamar o whisper.

### Botão de microfone

Com o `td voice` rodando, aparece na tela um botão redondo de microfone, de uns 44 px, sempre por cima das outras janelas. É a alternativa ao atalho quando você prefere usar o mouse, como o microfone de ditado do Chrome.

- **Clique** para começar a gravar e **clique de novo** para parar. Isso vale em qualquer `voice.mode`. O atalho continua funcionando como sempre e os dois podem ser misturados: no modo `toggle`, o atalho também para uma gravação iniciada pelo botão. No push-to-talk, soltar o atalho só encerra gravações iniciadas pelo atalho.
- **Arraste** o botão para onde quiser. A posição fica salva em `%LOCALAPPDATA%\TerminalDesign\voice\cache\button.json`. Se ela cair fora das telas atuais, por exemplo depois de desconectar um monitor, o botão volta para o canto inferior direito.
- **Clique com o botão direito** para abrir o menu: "Copiar última transcrição não inserida", "Esconder botão" e "Sair". Um botão escondido volta pelo menu da bandeja, em "Mostrar botão do microfone", ou na próxima vez que o `td voice` for iniciado.
- **Cores**:

  | Cor | Significado |
  |---|---|
  | Cinza | pronto |
  | Vermelho | gravando; o anel branco mostra o tempo gravado em relação a `voice.maxSeconds` e pulsa a cada segundo |
  | Âmbar | transcrevendo |
  | Âmbar, com a dica "texto guardado, clique com o botão direito para copiar" | a inserção foi bloqueada |

- **Clique no ícone da bandeja** (botão esquerdo) também liga e desliga a gravação.
- Para desligar o botão: `--no-button` ou `td config set voice.button false`.

O botão **nunca recebe foco**. A janela é criada com `WS_EX_NOACTIVATE` e `WS_EX_TOOLWINDOW` e responde `MA_NOACTIVATE` ao `WM_MOUSEACTIVATE`. Por isso, a janela em que você estava digitando continua em primeiro plano, e é para ela que o texto vai. A regra de destino é a mesma do atalho: o texto só é inserido na janela que estava em primeiro plano quando a gravação começou. Se nesse momento a janela em primeiro plano for do próprio td voice (botão, overlay, menu) ou a barra de tarefas, o td usa a última janela externa que esteve em primeiro plano, acompanhada por um gancho `EVENT_SYSTEM_FOREGROUND`. Se não houver nenhuma, a inserção é bloqueada ("nenhuma janela em foco") e o texto fica guardado para copiar.

Clicar no ícone da bandeja coloca a barra de tarefas em primeiro plano. A gravação usa a sua última janela como destino, mas o Windows só deixa digitar nela se ela voltar a ficar em foco antes do fim da transcrição. Se não voltar, a inserção é bloqueada e o texto fica guardado para copiar. Com o botão flutuante isso não acontece.

Começar e parar pelo botão usam o mesmo caminho do atalho: cada gravação é inserida uma única vez, `voice.maxSeconds` continua valendo e gravações curtas demais são descartadas. Cliques durante a parada de uma gravação, ou menos de 0,4 s depois de começar ou de parar, são ignorados, para que um clique duplo não comece e pare a gravação ao mesmo tempo.

### Proteções na hora de inserir o texto

| Situação | O que acontece |
|---|---|
| Você trocou de janela entre começar a falar e o fim da transcrição | **Nada é digitado.** O texto fica guardado e o aviso "Inserção cancelada: a janela mudou" aparece no overlay e no console. |
| O foco muda **no meio** da digitação | Para no bloco atual (no máximo 32 caracteres já enviados). O resto não é digitado e o texto inteiro fica guardado. |
| Ctrl, Alt, AltGr, Shift, Win ou a tecla do atalho ainda pressionados | O host espera até 1,5 s você soltar. Se continuarem pressionados, **nada é digitado**, para que as letras nunca virem atalhos. O aviso diz quais teclas estavam pressionadas. |
| Uma tecla é pressionada no meio da digitação | A digitação para do mesmo jeito que na troca de foco. |
| O Windows aceita só parte das teclas enviadas | Toda tecla que o td apertou é solta em seguida. Nenhuma tecla fica presa. |
| A mesma gravação pediria duas inserções | O host aceita só uma inserção por gravação, identificada pelo id dela, e recusa as repetições. |

**Copiar o texto guardado:** aperte **Enter** no terminal onde o `td voice` está rodando ou clique com o botão direito no ícone da bandeja e escolha **Copiar última transcrição não inserida**. A área de transferência só é usada quando você pede. O texto fica só na memória e some ao encerrar o `td voice`.

### Indicadores

- **Overlay**: uma faixa pequena acima da barra de tarefas mostra "● Gravando 3s" e depois "◌ Transcrevendo…". Ela nunca recebe foco, então o texto continua indo para a sua janela. Para desligar: `--no-overlay`.
- **Bandeja**: o ícone fica cinza quando está pronto, vermelho gravando e âmbar transcrevendo ou com texto guardado. Clique com o botão esquerdo para ligar ou desligar a gravação. O menu do ícone tem "Copiar última transcrição não inserida", "Mostrar botão do microfone" e "Sair". Para desligar: `--no-tray`.
- **Botão de microfone**: veja [Botão de microfone](#botão-de-microfone). Para desligar: `--no-button`.
- **Console**: uma linha por evento, com o texto reconhecido e o tempo que levou.

### Configuração (`td config set voice.<chave> <valor>`)

| Chave | Padrão | Valores |
|---|---|---|
| `voice.hotkey` | `Ctrl+Shift+F9` | modificadores `Ctrl`, `Alt`, `Shift`, `Win` + uma tecla (`A`-`Z`, `0`-`9`, `F1`-`F24`, `Space`, `Enter`, `Tab`, `Insert`, `Home`, `End`, `PageUp`, `PageDown`, setas, `` ` ``, `Pause`, `ScrollLock`, `Numpad0-9`…). `F1`-`F24`, `Pause` e `ScrollLock` funcionam sozinhas. Uma letra sem modificador, ou só com Shift, é recusada porque atrapalharia a digitação. |
| `voice.mode` | `push-to-talk` | `push-to-talk`, `toggle` |
| `voice.language` | `pt` | `pt`, `en`, `auto` (o whisper detecta o idioma) |
| `voice.model` | `base` | `tiny`, `base`, `small`, `medium` (todos multilíngues) |
| `voice.microphone` | `default` | `default` (o padrão do Windows), o índice mostrado em `td voice devices` ou parte do nome |
| `voice.insertMode` | `type` | `type` (teclas Unicode simuladas) ou `paste` (área de transferência + Ctrl+V) |
| `voice.appendSpace` | `true` | coloca um espaço depois de cada trecho, para emendar frases |
| `voice.maxSeconds` | `60` | 1 a 600 |
| `voice.button` | `true` | mostra o botão flutuante de microfone (`--no-button` desliga só nesta execução) |

#### Por que `Ctrl+Shift+F9`

O padrão antigo era `Ctrl+Alt+Space`. O Windows trata o **AltGr como Ctrl+Alt**, e no teclado ABNT2 o AltGr digita caracteres (AltGr+Q = `/`, AltGr+W = `?`, AltGr+E = `°`). Por isso, um atalho `Ctrl+Alt+<tecla>` podia disparar a gravação no meio da digitação. O `Ctrl+Shift+F9` não usa Alt, então o AltGr nunca o aciona. F9 não digita nada, e o CMD, o PowerShell, o Windows Terminal e o Windows não usam essa combinação.

Você pode usar outro atalho com `td config set voice.hotkey "<atalho>"`. Se escolher `Ctrl+Alt+<tecla que digita>`, o `td voice` e o `td doctor` avisam, e o host ignora o atalho enquanto o AltGr (Alt da direita) estiver pressionado. Um programa (uma extensão do VS Code, por exemplo) pode usar o mesmo atalho internamente. Nesse caso ele não recebe a combinação enquanto o `td voice` estiver rodando.

Para mudar só uma vez, sem alterar a config, use os flags `--hotkey=`, `--toggle`, `--language=`, `--model=`, `--mic=`, `--paste`, `--no-space`.

Na prática, o `tiny` responde em cerca de 1 s e erra mais; o `base` é um bom equilíbrio para português; `small` e `medium` são mais precisos, mas bem mais lentos na CPU.

## Privacidade

- O processamento é 100% local. O áudio vai do microfone para um WAV temporário em `voice\tmp\`, o `whisper-cli.exe` lê esse arquivo e o WAV é apagado logo depois, inclusive quando a transcrição falha. Na inicialização e no encerramento, qualquer WAV que tenha sobrado de uma queda é apagado.
- Nenhum áudio e nenhum texto é guardado em log ou enviado para algum lugar. O texto reconhecido só aparece no console do `td voice`.
- O único acesso à rede é o `td voice setup`, que baixa os arquivos listados acima, sempre com confirmação.
- No modo `paste`, o texto passa pela área de transferência e tudo o que estava nela antes (texto, imagem, arquivos copiados, HTML) é restaurado em seguida.

## Como funciona

```
td voice (Node)                         voice-host.ps1 -> voice-host.cs (Add-Type, .NET Framework)
  engine.js  <-- JSON lines (stdout) --   RegisterHotKey + GetAsyncKeyState (soltar = parar)
             --- JSON lines (stdin)  -->  waveIn 16 kHz / mono / 16 bit -> WAV
  whisper.js -> whisper-cli.exe -l pt     SendInput KEYEVENTF_UNICODE  |  Clipboard + Ctrl+V
  text.js (limpeza)                       NotifyIcon + overlay WS_EX_NOACTIVATE
```

- O host manda os eventos `ready`, `recording`, `audio {id, path, durationMs, peak}`, `cancelled`, `typed {id}`, `blocked {id, reason, keys}`, `copied`, `warn`, `error` e `quit`. O Node responde com `type {id, text}` (uma vez por gravação), `drop {id}`, `copy`, `state {state, message}` e `quit`. O protocolo completo está em `apps/voice-engine/src/protocol.js`.
- Se o Node morrer, o stdin do host fecha e ele sai sozinho. Nada fica rodando para trás.
- O helper C# é compilado na primeira execução, o que leva uns 2 s, e fica em cache por hash do código-fonte.
- As regras de inserção ficam em `Typist.Insert` (voice-host.cs). Esse código acessa o Windows só pela interface `IInputEnv`, então os testes (`tests/voice-insert.test.js`) rodam com um ambiente falso: não digitam em nenhuma janela, não tocam na área de transferência real e não tocam som. Ao disparar um atalho que tem Alt ou Win, o host injeta uma tecla neutra (vk 0xE8, o mesmo truque do AutoHotkey), para que soltar o Alt não abra o menu da janela.

### API programática

```js
import { resolveOptions, createEngine, test, listDevices, setup, status, doctor } from './apps/voice-engine/src/index.js';

const opts = resolveOptions({ config, overrides: { language: 'en' } });
const engine = createEngine(opts);
engine.on('transcript', ({ text }) => console.log(text));
engine.on('blocked', ({ text, message }) => console.warn(message, text)); // texto não inserido
engine.copyLast();             // copia o último texto não inserido
await engine.start();          // resolve quando o atalho está registrado
// ...
await engine.stop();

const { text } = await test(opts, { seconds: 5 }); // grava e transcreve, sem digitar
```

Também são exportadas as funções puras `parseHotkey`, `hotkeyWarnings`, `blockedMessage`, `cleanTranscript`, `buildWhisperArgs`, `parseLine`, `createLineDecoder` e `encodeCommand`.

## Limitações conhecidas

- **Janelas elevadas (administrador)**: o Windows (UIPI) descarta em silêncio o `SendInput` que um processo comum manda para uma janela elevada. Se o terminal em foco estiver rodando como administrador, rode o `td voice` também como administrador. O host avisa quando detecta esse caso, mas a detecção é por melhor esforço.
- **A tela de login, o UAC e alguns jogos ou anti-cheat** não aceitam entrada simulada.
- **Foco dentro da mesma janela**: o td compara a janela de primeiro nível. Se você trocar de aba ou de painel dentro do mesmo programa (abas do Windows Terminal, editor e terminal do VS Code), ele não percebe a troca, e o texto vai para onde estiver o cursor.
- **O atalho é exclusivo**: se outro programa já registrou a combinação, o `td voice` avisa e não inicia. Escolha outra com `--hotkey=`. A mesma combinação também deixa de chegar aos outros programas enquanto o `td voice` estiver rodando.
- **Nomes de microfone**: a API waveIn corta os nomes em 31 caracteres e os índices podem mudar quando você conecta ou desconecta um dispositivo. Prefira escolher por parte do nome. Com `default`, o que vale é o microfone padrão de *Configurações > Som > Entrada*. Se você mudar o microfone padrão enquanto o `td voice` estiver rodando, a mudança vale a partir da próxima gravação.
- **Modo `paste`**: antes de colar, o host copia todos os formatos que estão na área de transferência e depois os devolve. Alguns programas só entregam o conteúdo quando ele é colado de fato ("delayed rendering"); nesses casos a cópia não é possível. Então o host não mexe na área de transferência e digita o texto como no modo `type`, com um aviso no console. A restauração devolve os mesmos dados, mas o Windows passa a considerar o Terminal-Design como dono desse conteúdo. Alguns programas usam outro atalho para colar (no CMD clássico antigo, por exemplo, Ctrl+V depende de "Usar Ctrl+Shift+C/V").
- **Só CPU**: a build baixada é a `whisper-bin-x64` (CPU, sem BLAS). Para usar GPU (CUDA), baixe você mesmo um `whisper-cli.exe` com CUDA e aponte para ele com `--whisper=`.
- **O modelo é recarregado a cada trecho**, porque cada transcrição chama o `whisper-cli` de novo. Com o `base`, isso custa uma fração de segundo.
- **Alucinações**: em ruído ou silêncio o Whisper às vezes inventa frases ("Legendas pela comunidade Amara.org"). Frases conhecidas são descartadas quando são o texto inteiro, e áudio muito baixo nem chega a ser transcrito.
- **Só Windows**: em Linux e macOS, `td voice status` funciona e os outros subcomandos avisam que não há suporte.

## Licenças

- **whisper.cpp e ggml** (`whisper-cli.exe`, `whisper.dll`, `ggml*.dll`): MIT, © The ggml authors. São baixados como binários oficiais das releases de `ggml-org/whisper.cpp` e não vêm embutidos neste repositório.
- **SDL2** (`SDL2.dll`, licença zlib): vem no zip do upstream, mas é apagada na instalação e nunca é usada.
- **Microsoft Visual C++ Redistributable**: é um pré-requisito do sistema, não é distribuído pelo Terminal-Design.
- **Modelos ggml**: são pesos do [OpenAI Whisper](https://github.com/openai/whisper) (MIT), convertidos para ggml por Georgi Gerganov e distribuídos em `huggingface.co/ggerganov/whisper.cpp`.
- **O código deste módulo**: MIT, como o resto do Terminal-Design.
