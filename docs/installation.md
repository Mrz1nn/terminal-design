# Instalação

O Terminal-Design roda em Windows 10/11 com **Node.js 18.17 ou mais novo**. Ele não precisa de permissão de administrador e não instala nenhum pacote npm.

## 1. Pré-requisito: Node.js

Confira no terminal:

```powershell
node --version
```

Se o comando não existir ou mostrar uma versão menor que `v18.17.0`, instale o Node.js LTS em <https://nodejs.org/pt-br/download> e abra um terminal novo.

## 2. Baixar

Escolha um jeito:

- **Git:** `git clone https://github.com/Mrz1nn/terminal-design.git`
- **Zip:** baixe o `terminal-design-<versão>.zip` da página de [Releases](https://github.com/Mrz1nn/terminal-design/releases) e extraia.

## 3. Instalar

Dentro da pasta do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

> **Por que `-ExecutionPolicy Bypass`?** O Windows bloqueia scripts `.ps1` baixados por padrão. Essa opção libera só esta execução e não muda nenhuma configuração do sistema.

Opções:

| Opção | O que faz |
|---|---|
| `-Theme nord` | Define o tema (`td theme list` mostra todos). |
| `-ClaudeCode` | Também instala a status line no Claude Code (`td claude install`). |
| `-NoPath` | Não mexe no PATH. Você chama o programa pelo caminho completo do `td.cmd`. |

Exemplo completo:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Theme dracula -ClaudeCode
```

No fim, o instalador roda `td doctor`. **Abra um terminal novo** para o comando `td` funcionar, porque o PATH só vale em janelas abertas depois da instalação.

Pode rodar o instalador de novo quantas vezes quiser: ele substitui os arquivos do programa e mantém a sua configuração.

## O que é instalado e onde

Tudo fica dentro da sua pasta de usuário:

```
%LOCALAPPDATA%\TerminalDesign\          programa (substituído nas atualizações)
  versions\
    0.1.0\                              cópia completa de uma versão
    0.2.0\
  current.json                          {"version": "0.2.0", "previous": "0.1.0"}
  launcher.js                           lê current.json e roda versions\<versão>\bin\td.js
  package.json                          {"type": "commonjs"} para o launcher
  bin\
    td.cmd                              atalho para cmd, PowerShell e Windows Terminal
    td                                  atalho para Git Bash
  backups\                              cópias da configuração antes de cada mudança
  cache\                                resultado da última verificação de atualização
  staging\                              área temporária das atualizações

%APPDATA%\TerminalDesign\               sua configuração (nunca é tocada pelas atualizações)
  config.json
  themes\                               seus temas próprios
```

- O PATH do **usuário** ganha `%LOCALAPPDATA%\TerminalDesign\bin`. O PATH do sistema não é alterado.
- O `config.json` só é criado se ainda não existir. O instalador nunca o sobrescreve. Com `-Theme`, só a chave `theme.name` muda, e um backup é feito antes.
- Pastas como `.git`, `tests`, `node_modules` e `.github` não são copiadas.

Para testar sem mexer na sua instalação real, aponte as pastas para outro lugar:

```powershell
$env:TD_DATA_HOME = "$env:TEMP\td-teste\data"
$env:TD_CONFIG_HOME = "$env:TEMP\td-teste\config"
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -NoPath
```

## Rodar direto do clone (modo dev)

Sem instalar, de dentro da pasta do projeto:

```powershell
node bin\td.js
```

Nesse modo, `td update` só avisa que existe versão nova e pede para você usar `git pull`.

## Desinstalar

```powershell
td uninstall
```

ou, se o `td` não estiver no PATH:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1
```

O desinstalador:

1. pede confirmação;
2. remove a status line do Claude Code, mas só se for a do Terminal-Design (a anterior, se existia, é restaurada);
3. remove os esquemas de cor do Terminal-Design no Windows Terminal;
4. tira `bin\` do PATH do usuário;
5. apaga os arquivos do programa em `%LOCALAPPDATA%\TerminalDesign`;
6. pergunta se deve apagar também a configuração. A resposta padrão é **manter**.

| Opção | O que faz |
|---|---|
| `--yes` | Não pergunta nada e mantém a configuração. |
| `--keep-config` | Mantém configuração, temas e backups. |
| `--purge` | Apaga também `config.json`, `themes\` e os backups. |

Nada fora das pastas do Terminal-Design é apagado. Se você rodou a partir de um clone git, a pasta do clone também fica intacta.

## Problemas comuns

| Sintoma | Solução |
|---|---|
| `td` não é reconhecido | Abra um terminal novo. Se continuar, rode `td doctor` pelo caminho completo (`%LOCALAPPDATA%\TerminalDesign\bin\td.cmd doctor`) e veja a linha PATH. |
| "a execução de scripts foi desabilitada" | Use `powershell -ExecutionPolicy Bypass -File scripts\install.ps1`. |
| "precisa do Node.js 18.17" | Atualize o Node.js em <https://nodejs.org/pt-br/download>. |
| Aviso "não pôde ser carregado, usando a versão anterior" | A versão atual está danificada. Rode `td update --rollback` ou reinstale. |
