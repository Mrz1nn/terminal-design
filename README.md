# Terminal-Design

Cockpit de terminal open source para Windows 10 e 11. Ele mostra uma status line organizada no Claude Code, oferece 10 temas, se atualiza pelo próprio terminal e tem digitação por voz que funciona offline.

- **100% gratuito, licença MIT**, sem assinatura e sem API paga
- **Zero dependências npm em tempo de execução**: só Node.js e recursos do Windows
- **Offline**: só acessa a internet quando você pede (`td update`, `td voice setup`)
- **Sem telemetria**

```
Opus 5.5 high think │ ctx ━━━━──────── 34% 340k/1M │ 5h ━━━── 62% ↻2h15m │ 7d ━──── 18% ↻4d
meu-projeto │ ⎇ main +2 ~3 ?1 ↑1 │ +128 −42 │ $1.23 est. │ ⏱ 31m
```

## O que tem

| Módulo | O que faz |
|---|---|
| **Terminal Cockpit** | Status line do Claude Code em 1, 2 ou 3 linhas agrupadas: modelo, esforço, contexto, limites de 5h e 7d com o tempo até a renovação, git, alterações, custo estimado e duração. Também desenha o painel de subagentes. |
| **Temas** | Midnight, Dracula, Nord, Tokyo Night, Catppuccin, Gruvbox, One Dark, Monokai, Solarized e Terminal Classic. Permite personalizar cada cor, as barras, os separadores e as bordas. Importa e exporta temas e envia para o Windows Terminal e o VS Code. |
| **CLI `td`** | Painel, temas, configuração, diagnóstico, atualização e desinstalação. |
| **Update Engine** | Usa os GitHub Releases. Confere o SHA-256, faz backup e preserva a sua configuração. Se algo falhar, volta para a versão anterior. Nunca atualiza sem perguntar. |
| **Voice Engine** | Push-to-talk com atalho global e whisper.cpp local, em português e inglês. Insere o texto no cursor do CMD, PowerShell, Windows Terminal e VS Code. Nenhum áudio sai do computador. |

## Instalação

Requisitos: Windows 10 ou 11 e [Node.js](https://nodejs.org) 18.17 ou mais novo.

```powershell
git clone https://github.com/Mrz1nn/terminal-design.git
cd terminal-design
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -ClaudeCode
```

Abra um terminal novo e rode:

```powershell
td                # painel
td theme          # escolher tema
td doctor         # conferir a instalação
```

Os detalhes estão em [docs/installation.md](docs/installation.md).

## Comandos

| Comando | O que faz |
|---|---|
| `td` | Painel principal com os dados reais da última atualização do Claude Code, o estado do git e a instalação |
| `td help` | Lista todos os comandos |
| `td version` | Mostra a versão instalada |
| `td update` / `td update --check` | Atualiza / só verifica |
| `td theme` / `list` / `set <nome>` / `preview` / `import` / `export` / `wt` | Gerencia os temas |
| `td config` / `get` / `set` / `edit` / `reset` / `path` | Gerencia as configurações |
| `td claude install` / `uninstall` / `status` | Integração com o Claude Code |
| `td voice` / `setup` / `devices` / `test` / `status` | Digitação por voz |
| `td doctor` | Diagnóstico da instalação |
| `td uninstall` | Remove o Terminal-Design (pergunta antes se deve manter a sua configuração) |

## Métricas: o que é real e o que é estimativa

O cockpit só mostra o que o Claude Code envia oficialmente para a status line ([documentação](https://code.claude.com/docs/en/statusline)):

| Informação | Fonte | Observação |
|---|---|---|
| Modelo, esforço, thinking, fast mode | Payload oficial | |
| Contexto (%, tokens, tamanho) | `context_window` | Valor real |
| Limite de 5h e 7d, com o tempo até a renovação | `rate_limits` | Só aparece em planos Pro, Max e Ultra, depois da primeira resposta |
| Limite de gasto (diário, semanal ou mensal) | `rate_limits.spend_limit` | Só aparece atrás de um gateway do Claude apps |
| **Limite mensal da assinatura** | Não existe no payload | Nunca é exibido como número. Com `cockpit.showUnavailable` aparece como `n/d`. |
| **Modo de permissão** | Não existe no payload | Fica `n/d` |
| Custo `$ est.` | `cost.total_cost_usd` | Estimativa do Claude Code a preço de API. Não é cobrança. |
| Git | `git status` local | Fica em cache por 3 s |

Quando falta um dado, o widget some. Nada é inventado.

## Estrutura

```
apps/terminal-cockpit   status line e painel de agentes
apps/voice-engine       voz: host nativo em PowerShell/C# + whisper.cpp
packages/core           caminhos, I/O atômico, semver, ANSI, registro de módulos
packages/config         configuração central (padrões + arquivo do usuário)
packages/themes         motor de temas, validação, import/export
packages/updater        GitHub Releases, verificação, troca de versão e rollback
packages/cli            comando td
integrations/           claude-code, windows-terminal, vscode
themes/                 temas embutidos + theme.schema.json
docs/  scripts/  tests/  .github/
```

A arquitetura está explicada em [docs/architecture.md](docs/architecture.md).

## Documentação

- [Instalação](docs/installation.md)
- [Atualização](docs/updating.md)
- [Configuração](docs/configuration.md)
- [Temas](docs/themes.md)
- [Integração com o Claude Code](docs/claude-code.md)
- [Voice Engine](docs/voice.md)
- [Arquitetura](docs/architecture.md)
- [Como contribuir](CONTRIBUTING.md)
- [Segurança](SECURITY.md)
- [Avisos de terceiros](THIRD_PARTY_NOTICES.md)

## Licença

[MIT](LICENSE). As paletas de cores e os componentes baixados sob demanda têm as licenças listadas em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
