# Instalação

O Terminal-Design roda no **Windows 10/11**, no **macOS** (Intel e Apple Silicon) e no **Linux** (x64 e arm64). Ele precisa do **Node.js 18.17 ou mais novo**, não pede permissão de administrador (nem `sudo`) e não instala nenhum pacote npm.

## Instalação em uma linha (recomendada)

Um comando instala tudo: Node.js (se faltar), o programa, o atalho `td`, o PATH e a status line do Claude Code. No Windows, instala também a digitação por voz.

**macOS e Linux** (Terminal):

```sh
curl -fsSL https://raw.githubusercontent.com/Mrz1nn/terminal-design/main/scripts/get.sh | sh
```

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/Mrz1nn/terminal-design/main/scripts/get.ps1 | iex
```

No fim aparece um resumo do que foi instalado. **Abra um terminal novo e digite `td`.**

### O que o comando faz

1. **Node.js 18.17+.** Usa o que você já tem. Se faltar ou for antigo:
   - **macOS/Linux:** baixa o Node.js LTS oficial de nodejs.org para o seu sistema e processador, confere o SHA-256 com o `SHASUMS256.txt` oficial e coloca em `~/.local/share/terminal-design/node`. Esse Node.js é só do Terminal-Design. Nada do sistema muda e não precisa de `sudo`.
   - **Windows:** instala o Node.js LTS com o `winget` (`OpenJS.NodeJS.LTS`, pode aparecer uma confirmação do Windows). Sem `winget`, baixa o zip oficial de nodejs.org, confere o SHA-256 e coloca em `%LOCALAPPDATA%\TerminalDesign\node`.
2. **Programa.** Baixa a última release do GitHub, confere o SHA-256 com o `SHA256SUMS.txt` da release e só então extrai. Se o checksum não bater, para e não instala nada.
3. **Instalação.** Roda o instalador da própria release (`install.sh --claude-code` ou `install.ps1 -ClaudeCode`).
4. **Voz** (só Windows). Roda `td voice setup --yes` (modelo `base`, cerca de 150 MB). No macOS e no Linux a voz ainda não existe, e o resumo avisa isso.

O script inteiro fica dentro de uma função chamada só na última linha. Assim, um download cortado no meio não executa nada.

### Opções

| macOS/Linux | Windows | O que faz |
|---|---|---|
| `TD_NO_CLAUDE=1` | `$env:TD_NO_CLAUDE='1'` | Não configura a status line do Claude Code. |
| `TD_NO_VOICE=1` | `$env:TD_NO_VOICE='1'` | Não instala a voz. |
| `TD_THEME=nord` | `$env:TD_THEME='nord'` | Define o tema inicial. |
| `TD_NO_PATH=1` | `$env:TD_NO_PATH='1'` | Não mexe no PATH. |

Exemplos:

```sh
curl -fsSL https://raw.githubusercontent.com/Mrz1nn/terminal-design/main/scripts/get.sh | TD_THEME=nord sh
curl -fsSL https://raw.githubusercontent.com/Mrz1nn/terminal-design/main/scripts/get.sh | sh -s -- --theme=nord --no-claude
```

```powershell
$env:TD_NO_VOICE = '1'; irm https://raw.githubusercontent.com/Mrz1nn/terminal-design/main/scripts/get.ps1 | iex
```

## Instalação manual

### 1. Node.js

Confira no terminal:

```sh
node --version
```

Se o comando não existir ou mostrar uma versão menor que `v18.17.0`:

- **Windows:** instale o Node.js LTS em <https://nodejs.org/pt-br/download>.
- **macOS:** `brew install node`, ou o instalador de <https://nodejs.org/pt-br/download>.
- **Linux:** o gerenciador de pacotes da sua distribuição, ou <https://nodejs.org/pt-br/download>.

Depois abra um terminal novo.

### 2. Baixar

Escolha um jeito:

- **Git:** `git clone https://github.com/Mrz1nn/terminal-design.git`
- **Zip:** baixe o `terminal-design-<versão>.zip` da página de [Releases](https://github.com/Mrz1nn/terminal-design/releases) e extraia.

### 3a. Instalar no Windows

Dentro da pasta do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

> **Por que `-ExecutionPolicy Bypass`?** O Windows bloqueia scripts `.ps1` baixados por padrão. Essa opção libera só esta execução e não muda nenhuma configuração do sistema.

| Opção | O que faz |
|---|---|
| `-Theme nord` | Define o tema (`td theme list` mostra todos). |
| `-ClaudeCode` | Também instala a status line no Claude Code (`td claude install`). |
| `-NoPath` | Não mexe no PATH. Você chama o programa pelo caminho completo do `td.cmd`. |

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Theme dracula -ClaudeCode
```

### 3b. Instalar no macOS e no Linux

Dentro da pasta do projeto:

```sh
sh scripts/install.sh
```

Use sempre `sh scripts/install.sh`. O zip da release não guarda a permissão de execução, e assim funciona mesmo sem `chmod`.

| Opção | O que faz |
|---|---|
| `--theme=nord` | Define o tema (`td theme list` mostra todos). |
| `--claude-code` | Também instala a status line no Claude Code (`td claude install`). |
| `--no-path` | Não mexe nos arquivos de perfil do shell. Você chama o programa pelo caminho completo. |

```sh
sh scripts/install.sh --theme=dracula --claude-code
```

**Qual Node.js é usado?** O instalador usa o `node` do PATH, ou o que estiver em `TD_NODE`. O caminho completo desse Node.js fica gravado no atalho `td`. Assim, a status line do Claude Code acha o Node.js mesmo quando roda sem o seu perfil do shell (sem nvm ou Homebrew no PATH), o que é comum no macOS. Para escolher um Node.js específico:

```sh
TD_NODE=$(which node) sh scripts/install.sh --claude-code
```

Se esse Node.js for removido depois, o atalho procura nesta ordem: `$TD_NODE`, o Node.js gravado na instalação, o `node` do PATH, `/opt/homebrew/bin/node`, `/usr/local/bin/node`, `~/.volta/bin/node`, a versão mais nova em `~/.nvm/versions/node` e o alias padrão do fnm.

### Depois de instalar

No fim, o instalador roda `td doctor`. **Abra um terminal novo** para o comando `td` funcionar, porque o PATH só vale em janelas abertas depois da instalação.

Pode rodar o instalador de novo quantas vezes quiser. Ele substitui os arquivos do programa e mantém a sua configuração.

## O que é instalado e onde

### Windows

```
%LOCALAPPDATA%\TerminalDesign\          programa (substituído nas atualizações)
  versions\
    0.1.0\                              cópia completa de uma versão
    0.2.0\
  current.json                          {"version": "0.2.0", "previous": "0.1.0"}
  launcher.js                           lê current.json e roda versions\<versão>\bin\td.js
  package.json                          {"type": "commonjs"} para o launcher
  .terminal-design                      marcador da instalação (usado pelo desinstalador)
  bin\
    td.cmd                              atalho para cmd, PowerShell e Windows Terminal
    td                                  atalho para Git Bash
  node\                                 só se o get.ps1 baixou um Node.js próprio
  backups\                              cópias da configuração antes de cada mudança
  cache\                                resultado da última verificação de atualização
  staging\                              área temporária das atualizações

%APPDATA%\TerminalDesign\               sua configuração (nunca é tocada pelas atualizações)
  config.json
  themes\                               seus temas próprios
```

- O PATH do **usuário** ganha `%LOCALAPPDATA%\TerminalDesign\bin`. O PATH do sistema não é alterado.
- O `td.cmd` usa, nesta ordem: `%TD_NODE%`, o Node.js próprio em `node\` (se existir) e o `node` do PATH.

### macOS e Linux

```
~/.local/share/terminal-design/         programa (mesma estrutura do Windows)
  versions/  current.json  launcher.js  package.json  .terminal-design
  bin/td                                atalho (sh), acha o Node.js sozinho
  node/                                 só se o get.sh baixou um Node.js próprio
  backups/  cache/  staging/

~/.config/terminal-design/              sua configuração (nunca é tocada pelas atualizações)
  config.json
  themes/
```

O PATH é configurado com um bloco marcado no fim do `~/.zshrc` (o shell padrão do macOS):

```sh
# >>> terminal-design >>>
# Adicionado pelo instalador do Terminal-Design. Para remover: td uninstall
td_bin='/Users/voce/.local/share/terminal-design/bin'
case ":$PATH:" in
  *":$td_bin:"*) ;;
  *) PATH="$td_bin:$PATH"; export PATH ;;
esac
unset td_bin
# <<< terminal-design <<<
```

- **macOS:** o bloco vai para o `~/.zshrc` (criado se não existir) e também para o `~/.bash_profile`, se ele existir.
- **Linux:** o bloco vai para o `~/.bashrc` e o `~/.zshrc` que existirem. Se nenhum dos dois existir, vai para o `~/.profile`.
- **fish:** se existir `~/.config/fish`, é criado `~/.config/fish/conf.d/terminal-design.fish`.
- Cada arquivo ganha um backup em `backups/` antes de ser editado. Rodar de novo não duplica o bloco. Links simbólicos (dotfiles) e permissões dos arquivos são mantidos.

### Em todos os sistemas

- O `config.json` só é criado se ainda não existir. O instalador nunca o sobrescreve. Com tema, só a chave `theme.name` muda, e um backup é feito antes.
- Pastas como `.git`, `tests`, `node_modules` e `.github` não são copiadas.

Para testar sem mexer na sua instalação real, aponte as pastas para outro lugar:

```powershell
$env:TD_DATA_HOME = "$env:TEMP\td-teste\data"
$env:TD_CONFIG_HOME = "$env:TEMP\td-teste\config"
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -NoPath
```

```sh
TD_DATA_HOME=/tmp/td-teste/data TD_CONFIG_HOME=/tmp/td-teste/config sh scripts/install.sh --no-path
```

## Rodar direto do clone (modo dev)

Sem instalar, de dentro da pasta do projeto:

```sh
node bin/td.js
```

Nesse modo, `td update` só avisa que existe versão nova e pede para você usar `git pull`.

## Desinstalar

```sh
td uninstall
```

ou, se o `td` não estiver no PATH:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1
```

```sh
sh scripts/uninstall.sh
```

O desinstalador:

1. pede confirmação;
2. remove a status line do Claude Code, mas só se for a do Terminal-Design (a anterior, se existia, é restaurada);
3. remove os esquemas de cor do Terminal-Design no Windows Terminal;
4. tira `bin` do PATH: no Windows, do PATH do usuário; no macOS e no Linux, apaga só o bloco marcado dos arquivos de perfil, com backup antes;
5. apaga os arquivos do programa (incluindo o Node.js próprio, se o instalador de uma linha baixou um);
6. pergunta se deve apagar também a configuração. A resposta padrão é **manter**.

| Opção | O que faz |
|---|---|
| `--yes` | Não pergunta nada e mantém a configuração. |
| `--keep-config` | Mantém configuração, temas e backups. |
| `--purge` | Apaga também `config.json`, `themes` e os backups. |

Nada fora das pastas do Terminal-Design é apagado. A pasta só é apagada se tiver o marcador `.terminal-design` ou estiver no local padrão. Se você rodou a partir de um clone git, a pasta do clone também fica intacta.

## Problemas comuns

| Sintoma | Solução |
|---|---|
| `td` não é reconhecido | Abra um terminal novo. Se continuar, rode `td doctor` pelo caminho completo e veja a linha PATH. No Windows: `%LOCALAPPDATA%\TerminalDesign\bin\td.cmd doctor`. No macOS/Linux: `~/.local/share/terminal-design/bin/td doctor`. |
| "a execução de scripts foi desabilitada" (Windows) | Use `powershell -ExecutionPolicy Bypass -File scripts\install.ps1`. |
| "Permission denied" ao rodar `scripts/install.sh` | Rode com `sh scripts/install.sh`. |
| "precisa do Node.js 18.17" | Atualize o Node.js (<https://nodejs.org/pt-br/download>, ou `brew install node` no macOS), ou use o instalador de uma linha, que baixa um Node.js só para o Terminal-Design. |
| A status line do Claude Code não aparece no macOS | Reinstale apontando o Node.js: `TD_NODE=$(which node) sh scripts/install.sh --claude-code`. |
| "Node.js 18.17+ nao encontrado" ao rodar `td` | O Node.js gravado na instalação foi removido. Defina `TD_NODE` ou reinstale. |
| Aviso "não pôde ser carregado, usando a versão anterior" | A versão atual está danificada. Rode `td update --rollback` ou reinstale. |
