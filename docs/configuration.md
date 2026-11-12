# Configuração

Arquivo: `%APPDATA%\TerminalDesign\config.json`. Para ver o caminho, rode `td config path`.

O arquivo guarda **só o que você mudou**. Tudo o que falta vem dos padrões em [`packages/config/src/defaults.js`](../packages/config/src/defaults.js). Atualizações nunca alteram este arquivo, e cada `td config set` faz backup antes de gravar.

```powershell
td config                         # configuração efetiva
td config get cockpit.layout
td config set cockpit.locale en
td config reset cockpit.layout
td config edit                    # abre no editor ($EDITOR ou Bloco de Notas) e valida ao fechar
```

Se o arquivo tiver um valor inválido, o td usa o padrão daquela chave e avisa em `td config` e `td doctor`. Ele nunca quebra a status line por causa disso.

## Chaves

| Chave | Padrão | Valores |
|---|---|---|
| `theme.name` | `midnight` | Qualquer tema de `td theme list` |
| `theme.overrides` | `{}` | Veja [themes.md](themes.md) |
| `color.mode` | `auto` | `auto`, `truecolor`, `256`, `16`, `none`. `NO_COLOR` sempre desliga as cores. |
| `cockpit.layout` | `cockpit` | `compact`, `cockpit`, `full`, `custom` |
| `cockpit.rows` | `null` | Linhas de widgets (quando o layout é `custom`) |
| `cockpit.hide` | `[]` | Widgets que devem ficar escondidos |
| `cockpit.tips` | `true` | Dica do `/tema` e do `/td` na status line nos primeiros 3 dias |
| `cockpit.showUnavailable` | `false` | Mostra `n/d` nos dados que não existem |
| `cockpit.maxWidth` | `160` | Largura usada quando o Claude Code não informa `COLUMNS` |
| `cockpit.locale` | `pt-BR` | `pt-BR`, `en` |
| `cockpit.git.enabled` / `cacheMs` | `true` / `3000` | |
| `update.auto` | `notify` | `off` (nunca checa sozinho) ou `notify` (só avisa) |
| `update.checkIntervalHours` | `1` | |
| `update.channel` | `stable` | `stable`, `prerelease` |
| `update.repository` | `null` | `dono/repo` (para forks). `null` usa o do package.json |
| `telemetry` | `false` | O td não tem telemetria. A chave existe só para deixar isso explícito. |

## Variáveis de ambiente

| Variável | Efeito |
|---|---|
| `TD_CONFIG_HOME` / `TD_DATA_HOME` | Mudam as pastas de configuração e de dados |
| `NO_COLOR` | Desliga as cores |
| `TD_COLOR` | Força um modo de cor (`truecolor`, `256`, `16`, `none`) |
| `TD_DEBUG` | Mostra o stack trace dos erros |
| `CLAUDE_CONFIG_DIR` | Pasta do Claude Code (padrão `~/.claude`) |
| `GITHUB_TOKEN` | Opcional. Aumenta o limite de consultas à API do GitHub no `td update`. |
