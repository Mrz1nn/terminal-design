# Changelog

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [versionamento semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

## [0.3.1] - 2026-11-12

### Adicionado
- Comando `/tema` no Claude Code: `/tema` lista os temas numerados e `/tema nord` ou `/tema 6` aplica, sem sair da conversa. É instalado pelo `td claude install`, chega sozinho para quem já tinha a status line e sai no `td claude uninstall`. Um `tema.md` seu nunca é alterado.
- `td theme list` numera os temas, e `td theme set` e `td theme preview` aceitam o número.
- `td claude status` mostra se o `/tema` está instalado.

### Alterado
- A verificação de versão nova agora roda a cada hora, e não mais uma vez por dia: uma versão lançada aparece na status line em até cerca de uma hora. Continua anônima e em segundo plano (`update.checkIntervalHours`).

## [0.3.0] - 2026-11-12

### Removido
- Digitação por voz inteira: `td voice` e todos os subcomandos, o botão flutuante de microfone, a inicialização com o Windows, as chaves `voice.*` da configuração, o download do whisper.cpp e do modelo no instalador de uma linha (e as opções `TD_NO_VOICE`, `-NoVoice` e `--no-voice`) e a documentação. O `td uninstall` ainda apaga a pasta `voice` deixada por versões anteriores.

## [0.2.2] - 2026-11-12

### Adicionado
- Botão de microfone redesenhado, no estilo do microfone do ChatGPT: compacto, escuro, com bordas suaves e nítido em telas com escala. Estados bem distintos: pronto, gravando (barras de áudio e um halo que acompanha a sua voz), transcrevendo (arco girando), concluído (visto verde), texto guardado (prancheta âmbar) e erro (anel vermelho). As animações só rodam enquanto há algo acontecendo.
- Botão de copiar ao lado do microfone depois de cada transcrição. A última transcrição pode ser copiada sempre, tenha sido inserida ou não.
- Inserção automática opcional: `td config set voice.autoInsert false` (ou `--no-insert`) faz o td voice nunca digitar; o texto fica pronto para copiar.
- `voice.topmost` (ou `--no-topmost`) decide se o botão fica por cima das outras janelas.
- O botão lembra se você o escondeu.
- `td voice autostart on|off|status`: inicia a voz quando você entra no Windows, por um atalho na sua pasta Inicializar. Sem administrador e sem registro. O `td uninstall` remove o atalho.
- `td help <comando>`.

### Alterado
- Códigos de saída padronizados em todos os comandos: `0` sucesso, `1` falha, `2` erro de uso (comando ou subcomando desconhecido, argumento faltando, inválido ou sobrando). Antes, `td voice` saía com 2 e `td config`, `td theme` e `td claude` com 1 no mesmo caso.
- O aviso de texto da voz virou uma pílula discreta ao lado do botão.
- Configurações liga/desliga (`voice.button`, `voice.topmost`, `voice.autoInsert` e outras) só aceitam `true` ou `false`; um texto como `"false"` volta ao padrão em vez de ser lido errado.

### Segurança
- A voz não digita mais em janelas abertas como administrador quando ela mesma não é: o Windows descartaria as teclas sem avisar e o texto se perderia. Agora a inserção é cancelada e o texto fica pronto para copiar.

## [0.2.1] - 2026-11-11

### Corrigido
- A status line aceita JSON enviado pelo pipe do Windows PowerShell 5.1, que coloca um BOM no começo do texto. Antes aparecia "JSON inválido recebido do Claude Code".

## [0.2.0] - 2026-11-11

### Adicionado
- Suporte ao macOS, nos modelos com chip Apple e nos Intel, e ao Linux. Inclui o instalador `install.sh`, o PATH configurado por um bloco marcado no `~/.zshrc` e no `~/.bash_profile`, a atualização e a desinstalação. Inclui também um atalho que acha o Node.js mesmo quando o Claude Code roda a status line sem o seu perfil (Homebrew, nvm, Volta).
- Instalação de uma linha: `curl ... get.sh | sh` no Mac e no Linux, e `irm ... get.ps1 | iex` no Windows. Ela instala o Node.js se faltar, baixa a versão mais recente com SHA-256 conferido, liga a status line e, no Windows, já baixa a voz.
- Botão flutuante de microfone no Windows: clique para falar e clique de novo para parar. O botão nunca rouba o foco da sua janela. Clicar no ícone da bandeja também liga e desliga a gravação.
- Exportação de temas para o iTerm2 (`td theme export <nome> <arquivo>.itermcolors --iterm`).
- CI em Windows, Linux e macOS (Apple Silicon e Intel), com instalação real nos três.

## [0.1.1] - 2026-11-11

### Adicionado
- Botão de atualização: quando existe uma versão nova, a status line e o painel `td` mostram `[ ↑ atualizar para X ] td update`. Com Ctrl+clique, a página da versão abre no navegador. A informação vem do cache local, então a status line nunca espera a rede.
- README completo, com instalação pelo zip da release ou por git, atualização, comandos, temas, voz, configuração, desinstalação e problemas comuns.

### Corrigido
- O workflow de release roda os testes com `node --test`, que funciona em todas as versões do Node.
- O nome do projeto na status line saía errado quando o Terminal-Design rodava fora do Windows (WSL, Linux) e o caminho vinha com barras invertidas.
- O `td doctor` não acusa mais erro quando a voz, que é opcional, ainda não foi configurada ou quando não há microfone. Esses casos agora aparecem como pendência. A verificação do atalho deixou de aparecer duas vezes.

## [0.1.0] - 2026-11-11

### Adicionado
- Terminal Cockpit: status line do Claude Code com layouts `compact`, `cockpit`, `full` e `custom`. Mostra modelo, esforço, contexto, limites de 5h e 7d com o tempo até a renovação, limite de gasto, git, PR, alterações, custo estimado, duração e cache. Inclui o painel de subagentes.
- 10 temas: Midnight, Dracula, Nord, Tokyo Night, Catppuccin, Gruvbox, One Dark, Monokai Classic, Solarized e Terminal Classic.
- Personalização por `theme.overrides`, import e export de temas, fragmento para o Windows Terminal e snippet para o VS Code.
- CLI `td`: painel, help, version, theme, config, claude, doctor, update, voice e uninstall.
- Configuração central com padrões, validação e backup.
- Update Engine via GitHub Releases, com SHA-256, backup e rollback.
- Voice Engine com push-to-talk e whisper.cpp local.
- Instalador PowerShell, CI e templates de issue.

### Segurança (Voice Engine)
- O texto só é inserido na janela que estava em foco quando a gravação começou. Se o foco mudar antes ou durante a digitação, nada mais é digitado e o texto fica guardado para cópia manual (Enter no terminal ou menu da bandeja).
- Se Ctrl, Alt, AltGr, Shift, Win ou a tecla do atalho continuarem pressionados depois de 1,5 s, a inserção é cancelada. Toda tecla injetada é solta, mesmo quando o Windows aceita só parte do envio.
- Cada gravação só pode ser inserida uma vez.
- O atalho padrão é `Ctrl+Shift+F9`, que não conflita com o AltGr do teclado ABNT2.
