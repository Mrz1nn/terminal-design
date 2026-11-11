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

O que ele garante:

- Faz backup do `settings.json` em `%LOCALAPPDATA%\TerminalDesign\backups` antes de qualquer mudança.
- Guarda a status line que você tinha antes e a devolve no `uninstall`.
- Reconhece as próprias entradas pelo marcador `--from=terminal-design` e nunca remove a status line de outro programa.
- Pergunta antes de substituir uma status line de terceiros.
- Usa `refreshInterval: 30` para que a contagem até a renovação dos limites e o git continuem atualizados mesmo sem mensagens novas.

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
| `monthly` | Sempre `n/d`: o Claude Code não informa limite mensal de assinatura | — |
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
