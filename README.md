# Terminal-Design

Um cockpit para o terminal do Windows e do Mac. Ele mostra uma status line organizada no Claude Code, traz 10 temas de cores, digita por voz sem internet (no Windows) e se atualiza com um único comando.

Gratuito, open source (licença MIT), sem assinatura, sem API paga e sem telemetria.

```
Opus 5.5 high think │ ctx ━━━━──────── 34% 340k/1M │ 5h ━━━── 62% ↻2h15m │ 7d ━──── 18% ↻4d
meu-projeto │ ⎇ main +2 ~3 ?1 ↑1 │ +128 −42 │ $1.23 est. │ ⏱ 31m
```

## Sumário

1. [O que ele faz](#o-que-ele-faz)
2. [Requisitos](#requisitos)
3. [Instalação](#instalação)
4. [Primeiros passos](#primeiros-passos)
5. [Atualizações](#atualizações)
6. [Comandos](#comandos)
7. [Status line do Claude Code](#status-line-do-claude-code)
8. [Temas](#temas)
9. [Digitação por voz](#digitação-por-voz)
10. [Configuração](#configuração)
11. [Desinstalar](#desinstalar)
12. [Privacidade e segurança](#privacidade-e-segurança)
13. [Problemas comuns](#problemas-comuns)
14. [Estrutura do projeto](#estrutura-do-projeto)
15. [Como contribuir](#como-contribuir)
16. [Licença](#licença)

## O que ele faz

| Recurso | Descrição |
|---|---|
| Status line | Mostra no Claude Code o modelo, o esforço, o uso do contexto, os limites de 5 horas e de 7 dias com o tempo até renovar, o git, as linhas alteradas, o custo estimado e a duração da sessão. Organiza tudo em 1, 2 ou 3 linhas. |
| Painel de agentes | Mostra uma linha por subagente, com o estado, o uso de contexto, o tempo e o progresso. |
| Temas | Traz 10 temas prontos. Você pode mudar qualquer cor, as barras, os separadores e as bordas, e também importar e exportar temas. Envia as cores para o Windows Terminal, o iTerm2 e o VS Code. |
| Comando `td` | Abre um painel com as informações disponíveis e gerencia temas, configuração, atualização, voz e diagnóstico. |
| Atualização | Quando sai uma versão nova, um botão aparece na status line. O comando `td update` baixa a versão, confere a integridade e instala sem mexer na sua configuração. |
| Voz | Você segura um atalho, fala e solta, e o texto é digitado onde está o cursor. A transcrição é feita no seu computador, em português ou inglês. Por enquanto, só no Windows. |

## Requisitos

1. Windows 10 ou 11, ou macOS. No Mac, funciona tanto nos modelos com chip Apple (M1, M2, M3, M4 e seguintes) quanto nos modelos Intel. Os testes automáticos rodam no macOS 15 nos dois tipos de processador. Versões mais antigas do macOS que rodam o Node.js 18 ou mais novo também devem funcionar.
2. [Node.js](https://nodejs.org/pt-br/download) 18.17 ou mais novo. A versão LTS é a recomendada. No Mac, também dá para instalar com `brew install node`.
3. Para a status line: [Claude Code](https://code.claude.com) instalado.
4. Para a voz (só no Windows): um microfone e o Microsoft Visual C++ Redistributable x64, que a maioria dos computadores já tem. O `td doctor` avisa se estiver faltando.

Não precisa de permissão de administrador.

## Instalação

### Jeito mais fácil: uma linha só

**No Mac** (ou Linux), abra o app Terminal e cole:

```bash
curl -fsSL https://raw.githubusercontent.com/Mrz1nn/terminal-design/main/scripts/get.sh | sh
```

**No Windows**, abra o PowerShell e cole:

```powershell
irm https://raw.githubusercontent.com/Mrz1nn/terminal-design/main/scripts/get.ps1 | iex
```

Esse único comando faz o seguinte:
1. Se não tiver o Node.js, instala.
   - No Mac, baixa uma cópia oficial só para o Terminal-Design, sem pedir senha e sem mexer no resto do sistema.
   - No Windows, usa o winget, que pode pedir uma confirmação do Windows.
2. Baixa a versão mais recente e confere o SHA-256 antes de usar qualquer arquivo.
3. Instala e liga a status line no Claude Code.
4. No Windows, já baixa a digitação por voz.

Ao terminar, abra um terminal novo e digite `td`.

Opções, para quem quiser personalizar:

| No Mac | No Windows | Efeito |
|---|---|---|
| `TD_NO_CLAUDE=1` | `$env:TD_NO_CLAUDE=1` | Não liga a status line no Claude Code |
| `TD_NO_VOICE=1` | `$env:TD_NO_VOICE=1` | Não baixa a voz |
| `TD_THEME=nord` | `$env:TD_THEME='nord'` | Já escolhe um tema |

No Mac, a opção vai antes do `sh`. Por exemplo: `curl -fsSL .../get.sh | TD_THEME=nord sh`. No Windows, defina a variável na mesma janela antes de colar o comando.

Se preferir instalar passo a passo, use um dos jeitos abaixo.

### No Mac

1. Abra a página de [Releases](https://github.com/Mrz1nn/terminal-design/releases/latest) e baixe o arquivo `terminal-design-<versão>.zip`.
2. Abra a pasta Downloads e dê dois cliques no zip para extrair, se o Safari ainda não tiver extraído.
3. Abra o app **Terminal**. Ele fica em Aplicativos, Utilitários, ou pode ser aberto pelo Spotlight com Cmd+Espaço.
4. Rode os dois comandos abaixo, trocando `<versão>` pelo número da versão baixada:

```bash
cd ~/Downloads/terminal-design-<versão>
sh scripts/install.sh --claude-code
```

5. Feche a janela do Terminal e abra outra.

Para instalar com git em vez do zip:

```bash
git clone https://github.com/Mrz1nn/terminal-design.git
cd terminal-design
sh scripts/install.sh --claude-code
```

No Mac, o programa fica em `~/.local/share/terminal-design` e a configuração em `~/.config/terminal-design`. O instalador acrescenta um bloco marcado ao `~/.zshrc` para o comando `td` funcionar, e ao `~/.bash_profile` se ele existir. Antes de mexer nesses arquivos, faz backup. Para o Claude Code, o instalador registra um atalho que acha o Node.js sozinho, inclusive quando ele foi instalado pelo Homebrew, nvm ou Volta.

Opções do instalador no Mac: `--claude-code`, `--theme=nord` e `--no-path`.

### No Windows: baixar a versão pronta

1. Abra a página de [Releases](https://github.com/Mrz1nn/terminal-design/releases/latest).
2. Baixe o arquivo `terminal-design-<versão>.zip`.
3. Clique com o botão direito no zip, escolha **Extrair tudo** e abra a pasta extraída.
4. Clique com o botão direito em um espaço vazio da pasta e escolha **Abrir no Terminal**.
5. Rode:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -ClaudeCode
```

### No Windows: clonar com git

```powershell
git clone https://github.com/Mrz1nn/terminal-design.git
cd terminal-design
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -ClaudeCode
```

### O que o instalador do Windows faz

1. Confere se o Node.js está instalado e na versão certa.
2. Copia o programa para `%LOCALAPPDATA%\TerminalDesign\versions\<versão>`.
3. Cria a sua configuração em `%APPDATA%\TerminalDesign\config.json`. Ele só cria o arquivo se ainda não existir e nunca o sobrescreve.
4. Adiciona o comando `td` ao PATH do seu usuário.
5. Com `-ClaudeCode`, liga a status line no Claude Code. Antes de mexer, ele faz um backup do `settings.json` e guarda a status line que você tinha, para devolver se um dia você desinstalar.
6. Roda um diagnóstico no final.

Opções do instalador do Windows:

| Opção | Efeito |
|---|---|
| `-ClaudeCode` | Também instala a status line no Claude Code |
| `-Theme nord` | Já escolhe um tema |
| `-NoPath` | Não mexe no PATH. Nesse caso, use o caminho completo do `td.cmd`. |

Pode rodar o instalador de novo quantas vezes quiser. A sua configuração continua igual.

## Primeiros passos

Abra um terminal **novo** (para o PATH valer) e rode:

```powershell
td            # painel principal
td theme      # escolher um tema numa lista com amostras de cor
td doctor     # conferir se está tudo certo
```

A status line aparece na próxima mensagem que você mandar no Claude Code.

## Atualizações

Você não precisa reinstalar nada para receber versões novas.

**Como você fica sabendo:** uma vez por dia, em segundo plano, o Terminal-Design consulta as releases públicas deste repositório. A consulta é anônima, sem token e sem dados pessoais. Quando existe uma versão mais nova, aparece um botão na status line do Claude Code e no painel `td`:

```
[ ↑ atualizar para 0.2.0 ] td update
```

Com Ctrl+clique no botão, a página com as novidades da versão abre no navegador.

**Como atualizar:**

```powershell
td update            # mostra o que mudou e pede confirmação
td update --yes      # atualiza sem perguntar
td update --check    # só verifica, sem instalar
td update --rollback # volta para a versão anterior
```

**O que acontece numa atualização:**

1. O pacote é baixado da página de Releases do GitHub.
2. O SHA-256 do pacote é conferido com o arquivo `SHA256SUMS.txt` da release. Se não bater, a atualização é recusada.
3. A sua configuração recebe um backup antes de qualquer mudança.
4. A versão nova é instalada ao lado da atual e testada. Só depois ela é ativada.
5. Se algo der errado, a versão anterior continua funcionando.
6. Temas próprios e a configuração ficam em outra pasta e nunca são tocados.

Nada é instalado sem você mandar. Para desligar o aviso:

```powershell
td config set update.auto off
```

Para religar: `td config set update.auto notify`. Se você usa a versão clonada com git, o aviso sugere `git pull` em vez de `td update`.

## Comandos

| Comando | O que faz |
|---|---|
| `td` | Painel com a última atualização recebida do Claude Code, o git da pasta atual e o estado da instalação |
| `td help` | Lista todos os comandos |
| `td <comando> --help` | Mostra os detalhes de um comando |
| `td version` | Mostra a versão instalada |
| `td update` | Atualiza (veja [Atualizações](#atualizações)) |
| `td theme` | Escolhe o tema numa lista |
| `td theme list` | Lista os temas |
| `td theme set <nome>` | Aplica um tema. Com `--wt`, envia as cores ao Windows Terminal. |
| `td theme preview <nome>` | Mostra a status line com o tema, usando dados de exemplo |
| `td theme import <arquivo>` | Instala um tema a partir de um arquivo `.json` |
| `td theme export <nome> <arquivo>` | Exporta um tema. Com `--vscode`, gera as cores para o VS Code. |
| `td theme wt` | Envia todos os temas ao Windows Terminal |
| `td config` | Mostra a configuração |
| `td config set <chave> <valor>` | Muda um valor |
| `td config edit` | Abre o arquivo de configuração no editor |
| `td claude install` | Liga a status line no Claude Code |
| `td claude uninstall` | Desliga e devolve a status line que você tinha antes |
| `td voice` | Inicia a digitação por voz |
| `td voice setup` | Baixa os arquivos da voz |
| `td voice test` | Grava alguns segundos e mostra o texto, sem digitar nada |
| `td doctor` | Diagnóstico completo |
| `td uninstall` | Remove o Terminal-Design |

Para tirar as cores de qualquer comando, use `--no-color` ou defina a variável `NO_COLOR`.

## Status line do Claude Code

### Layouts

```powershell
td config set cockpit.layout compact   # 1 linha
td config set cockpit.layout cockpit   # 2 linhas (padrão)
td config set cockpit.layout full      # 3 linhas
```

Também dá para escolher os itens de cada linha:

```powershell
td config set cockpit.layout custom
td config set cockpit.rows '[["model","context","limit5h"],["dir","git","cost"]]'
```

Para esconder um item: `td config set cockpit.hide '["cost"]'`.

### O que é real e o que é estimativa

O Terminal-Design só mostra o que o Claude Code envia oficialmente para a status line e o que vem do próprio computador, como o git. Nenhum número é inventado.

| Informação | Origem | Observação |
|---|---|---|
| Modelo, esforço, thinking | Claude Code | |
| Contexto usado e tamanho da janela | Claude Code | Valor real |
| Limites de 5 horas e de 7 dias, com o tempo até renovar | Claude Code | Aparece nos planos Pro, Max e Ultra, depois da primeira resposta. Some quando passa a hora da renovação, até chegar um dado novo. |
| Limite de gasto | Claude Code | Só aparece para quem usa um gateway corporativo |
| Limite mensal da assinatura | Não existe | O Claude Code não informa esse dado, então ele nunca aparece como número |
| Custo `$ est.` | Claude Code | Estimativa a preço de API. Não é cobrança. |
| Git | Seu computador | |

Os itens sem dado somem. Para ver `n/d` no lugar deles: `td config set cockpit.showUnavailable true`.

## Temas

Temas prontos: Midnight (padrão), Dracula, Nord, Tokyo Night, Catppuccin, Gruvbox, One Dark, Monokai, Solarized e Terminal Classic.

```powershell
td theme set tokyo-night
```

Para mudar só algumas cores sem criar um tema:

```powershell
td config set theme.overrides.palette.primary "#ff8800"
td config set theme.overrides.style.bar.width 12
td config set theme.overrides.style.border square
```

Para criar um tema seu:

```powershell
td theme export dracula meu-tema.json --as meu-tema
# edite meu-tema.json
td theme import meu-tema.json
td theme set meu-tema
```

No **Windows Terminal**, rode `td theme wt` e escolha `TD <tema>` em Configurações, Perfil, Aparência, Esquema de cores. O arquivo de configuração do Windows Terminal não é alterado.

No **iTerm2** (Mac), rode `td theme export tokyo-night tokyo-night.itermcolors --iterm`. Depois, no iTerm2, abra Settings, Profiles, Colors, Color Presets, escolha Import e selecione o arquivo.

No **VS Code**, rode `td theme export tokyo-night cores.json --vscode` e cole o conteúdo no `settings.json` do VS Code.

Os detalhes estão em [docs/themes.md](docs/themes.md).

## Digitação por voz

Por enquanto, a voz funciona só no Windows. No Mac, `td voice` avisa que ainda não há suporte, e o resto do Terminal-Design funciona normalmente.

```powershell
td voice setup   # baixa o transcritor e o modelo (pergunta antes, mostra tamanho e origem)
td voice test    # grava 5 segundos e mostra o texto, sem digitar nada
td voice         # inicia
```

Com o `td voice` rodando, segure **Ctrl+Shift+F9**, fale e solte. O texto aparece onde está o cursor: CMD, PowerShell, Windows Terminal, VS Code e outros programas.

Proteções:

1. O texto só vai para a janela que estava em foco quando você começou a falar. Se você trocar de janela, nada é digitado e o texto fica guardado.
2. Se alguma tecla como Ctrl, Alt ou Shift estiver pressionada na hora de digitar, nada é digitado. Assim as letras nunca viram atalhos.
3. Para copiar um texto guardado, aperte Enter no terminal do `td voice` ou use o menu do ícone perto do relógio.
4. O áudio nunca sai do computador e é apagado assim que a transcrição termina.

O atalho é configurável: `td config set voice.hotkey "Ctrl+Shift+F8"`. O idioma também: `td config set voice.language en`. O guia completo está em [docs/voice.md](docs/voice.md).

## Configuração

O arquivo fica em `%APPDATA%\TerminalDesign\config.json` no Windows e em `~/.config/terminal-design/config.json` no Mac. Ele guarda só o que você mudou. Os principais valores:

| Chave | Padrão | Valores |
|---|---|---|
| `theme.name` | `midnight` | Qualquer tema de `td theme list` |
| `cockpit.layout` | `cockpit` | `compact`, `cockpit`, `full`, `custom` |
| `cockpit.locale` | `pt-BR` | `pt-BR`, `en` |
| `update.auto` | `notify` | `notify` (avisa) ou `off` |
| `update.channel` | `stable` | `stable` ou `prerelease` |
| `voice.hotkey` | `Ctrl+Shift+F9` | Qualquer combinação válida |
| `voice.language` | `pt` | `pt`, `en`, `auto` |
| `voice.model` | `base` | `tiny`, `base`, `small`, `medium` |

A lista completa está em [docs/configuration.md](docs/configuration.md).

## Desinstalar

```powershell
td uninstall           # pergunta antes de cada passo
td uninstall --yes     # remove sem perguntar e mantém a configuração
td uninstall --purge   # remove também a configuração, os temas próprios e os backups
```

A desinstalação faz o seguinte:

1. Desliga a status line no Claude Code e devolve a que você tinha antes.
2. Tira o `td` do PATH. No Mac, remove só o bloco marcado que ele tinha colocado no `~/.zshrc` e no `~/.bash_profile`.
3. Apaga só as pastas criadas pelo Terminal-Design.

## Privacidade e segurança

1. Não há telemetria.
2. A internet só é usada para:
   - a consulta diária de versão nova, que pode ser desligada;
   - o `td update`;
   - o `td voice setup`.
   Os dois últimos sempre pedem confirmação.
3. Todo pacote baixado tem o hash conferido antes de ser usado.
4. Antes de mudar qualquer arquivo de outro programa, o Terminal-Design faz backup. Se o arquivo estiver com erro, ele não mexe.
5. O código não tem dependências de terceiros em tempo de execução.

Para relatar uma falha de segurança, veja [SECURITY.md](SECURITY.md).

## Problemas comuns

**O comando `td` não é encontrado.**
Abra um terminal novo. Se ainda não funcionar, rode no Windows `"%LOCALAPPDATA%\TerminalDesign\bin\td.cmd" doctor`, ou no Mac `~/.local/share/terminal-design/bin/td doctor`.

**No Mac, a status line diz que não achou o Node.js.**
Isso acontece quando o Node.js foi instalado num lugar fora do comum. Rode `which node` e reinstale com `TD_NODE=<caminho que apareceu> sh scripts/install.sh --claude-code`. Outra opção é instalar o Node.js com `brew install node`.

**No Mac, aparece "permissão negada" ao rodar o instalador.**
Use `sh scripts/install.sh` exatamente assim, com o `sh` na frente.

**O Windows bloqueou o script de instalação.**
Use exatamente o comando com `-ExecutionPolicy Bypass` mostrado em [Instalação](#instalação). Ele vale só para essa execução e não muda nada no seu sistema.

**A status line não aparece no Claude Code.**
Rode `td claude status`. Se aparecer como não instalada, rode `td claude install` e mande uma mensagem nova no Claude Code.

**Os limites de 5 horas e de 7 dias não aparecem.**
Eles só existem para os planos Pro, Max e Ultra, e chegam depois da primeira resposta da sessão.

**A voz não digita em um programa.**
Programas abertos como administrador não aceitam digitação de programas comuns. Abra o `td voice` também como administrador, ou abra o programa sem ser administrador.

**Quero voltar para a versão anterior.**
Rode `td update --rollback`.

## Estrutura do projeto

```
apps/terminal-cockpit   status line e painel de agentes
apps/voice-engine       digitação por voz
packages/core           base comum: caminhos, arquivos, versões, cores
packages/config         configuração central
packages/themes         motor de temas
packages/updater        instalação, atualização e desinstalação
packages/cli            comando td
integrations/           Claude Code, Windows Terminal, VS Code
themes/                 temas prontos e o formato dos temas
docs/                   documentação
scripts/                instalador e empacotamento
tests/                  testes automatizados
```

Documentação técnica:

- [Arquitetura](docs/architecture.md)
- [Instalação](docs/installation.md)
- [Atualização](docs/updating.md)
- [Configuração](docs/configuration.md)
- [Temas](docs/themes.md)
- [Claude Code](docs/claude-code.md)
- [Voz](docs/voice.md)

## Como contribuir

Ideias, correções e temas novos são bem-vindos. As regras e o passo a passo estão em [CONTRIBUTING.md](CONTRIBUTING.md). Para testar localmente:

```powershell
git clone https://github.com/Mrz1nn/terminal-design.git
cd terminal-design
npm test
node bin/td.js doctor
```

## Licença

[MIT](LICENSE). Os créditos das paletas de cores e dos componentes baixados sob demanda estão em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
