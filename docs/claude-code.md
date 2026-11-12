# Integração com o Claude Code

## Instalar e remover

```powershell
td claude install        # status line + painel de subagentes
td claude status
td claude uninstall      # remove e restaura a status line que você tinha antes
```

O `td claude install` altera **somente** duas chaves oficiais do `~/.claude/settings.json`:

```json
{
  "statusLine": { "type": "command", "command": "node \".../launcher.js\" statusline --from=terminal-design", "refreshInterval": 30 },
  "subagentStatusLine": { "type": "command", "command": "node \".../launcher.js\" statusline --subagent --from=terminal-design" }
}
```

No Mac (e no Linux), o comando registrado é o atalho `"~/.local/share/terminal-design/bin/td" statusline --from=terminal-design`. O Claude Code roda a status line num shell sem o seu perfil, e por isso muitas vezes não enxerga o Node.js instalado pelo Homebrew, nvm ou Volta. O atalho resolve isso procurando o Node.js nesta ordem:

1. a variável `TD_NODE`;
2. o Node.js usado na instalação;
3. o PATH;
4. o Homebrew (`/opt/homebrew/bin` e `/usr/local/bin`);
5. o Volta;
6. o nvm.

O que ele garante:

- Faz backup do `settings.json` em `%LOCALAPPDATA%\TerminalDesign\backups` antes de qualquer mudança.
- Guarda a status line que você tinha antes e a devolve no `uninstall`.
- Reconhece as próprias entradas pelo marcador `--from=terminal-design` e nunca remove a status line de outro programa.
- Pergunta antes de substituir uma status line de terceiros.
- Usa `refreshInterval: 30` para que a contagem até a renovação dos limites e o git continuem atualizados mesmo sem mensagens novas.

## Comando `/td`

O `td claude install` também cria `~/.claude/commands/td.md`:

| Comando | Faz |
|---|---|
| `/td` | mostra a versão e as opções |
| `/td atualizar` | `td update --yes` |
| `/td verificar` | `td update --check` |
| `/td voltar` | `td update --rollback` |
| `/td layout compacto\|cockpit\|completo` | muda o layout da status line |
| `/td diagnóstico` | `td doctor` |
| `/td dicas off` | desliga as dicas da status line |

Ele roda sem pedir permissão só para esses subcomandos do `td`. Com o `/td` instalado, o aviso de versão nova na status line diz `/td atualizar` em vez de `td update`.

Nos primeiros 3 dias, a status line mostra a dica `dica: /tema muda as cores · /td atualiza` quando não há aviso de versão. Para desligar: `/td dicas off` ou `td config set cockpit.tips false`.

## Comando `/tema`

O `td claude install` também cria `~/.claude/commands/tema.md`. No Claude Code:

- `/tema` mostra os temas numerados, com o atual marcado;
- `/tema nord` ou `/tema 6` aplica o tema. A status line muda em alguns segundos;
- `/tema nord terminal` aplica também no Windows Terminal, e `/tema terminal off` desfaz.

O comando roda sem pedir permissão, porque o arquivo libera só `td theme` (`allowed-tools`).

O arquivo leva o marcador `<!-- terminal-design:command`. Um `tema.md` seu, sem esse marcador, nunca é alterado nem apagado. Quem já tinha a status line instalada recebe o `/tema` sozinho, uma única vez, na primeira vez que a status line roda depois de atualizar. Se você apagar o arquivo, ele não volta. O `td claude uninstall` remove só o arquivo com o marcador.

## Layouts

```powershell
td config set cockpit.layout compact   # 1 linha
td config set cockpit.layout cockpit   # 2 linhas (padrão)
td config set cockpit.layout full      # 3 linhas
```

Para escolher os widgets de cada linha:

```powershell
td config set cockpit.layout custom
td config set cockpit.rows '[["model","context","limit5h"],["dir","git","cost"]]'
td config set cockpit.hide '["cost"]'
```

## Widgets

| id | Mostra | Fonte |
|---|---|---|
| `model` | Nome do modelo, esforço, thinking, fast | `model`, `effort`, `thinking`, `fast_mode` |
| `context` | Barra, %, tokens usados / tamanho da janela | `context_window` |
| `limit5h`, `limit7d` | Barra, %, tempo até a renovação | `rate_limits.five_hour` / `seven_day` |
| `spend` | Limite de gasto e período | `rate_limits.spend_limit` (só gateway) |
| `monthly` | Sempre `n/d`: o Claude Code não informa limite mensal de assinatura | não existe |
| `dir` | Projeto e subpasta | `workspace` |
| `git` | Branch, staged, modificados, não rastreados, conflitos, ahead/behind | `git status` local |
| `pr` | Número e estado do PR, com link clicável | `pr` |
| `worktree` | Nome da worktree | `worktree` |
| `agent` | Agente (`--agent`) | `agent.name` |
| `changes` | Linhas adicionadas e removidas | `cost.total_lines_*` |
| `cost` | `$ est.`: estimativa a preço de API, não é cobrança | `cost.total_cost_usd` |
| `duration` | Duração da sessão | `cost.total_duration_ms` |
| `session` | Nome da sessão | `session_name` |
| `mode` | Modo vim, output style e permissão (`n/d`) | `vim`, `output_style` |
| `cache` | Taxa de acerto do prompt cache e TTL | `prompt_cache` |
| `claudeVersion` | Versão do Claude Code | `version` |
| `update` | Aviso de nova versão do td (do cache, sem rede) | updater |

Para ver também o que está indisponível, rode `td config set cockpit.showUnavailable true`.

## Painel de subagentes

O `subagentStatusLine` recebe `{ columns, tasks[] }` e devolve uma linha JSON `{"id","content"}` por tarefa, como diz a documentação oficial. Cada linha mostra estado (●, ✓, ✗ ou ■), nome ou tipo, uso de contexto quando o Claude Code informa o tamanho da janela, modelo, tempo decorrido e o rótulo de progresso cortado para caber na largura.

## Painel `td`

Fora do Claude Code, o `td` mostra a **última** atualização real que o Claude Code enviou, com a idade dela (por exemplo, "há 3m"), mais o git da pasta atual. Esse payload fica só em `%LOCALAPPDATA%\TerminalDesign\cache\last-statusline.json`.

## Desempenho

Cada atualização roda um processo Node. O git usa `--no-optional-locks`, tem timeout de 1,5 s e cache de 3 s. A checagem de atualização na status line só lê o cache e nunca acessa a rede.
