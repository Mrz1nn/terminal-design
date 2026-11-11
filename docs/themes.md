# Temas

## Usar

```powershell
td theme                     # escolher numa lista com amostras de cor
td theme list
td theme set tokyo-night
td theme set nord --wt       # também envia os esquemas ao Windows Terminal
td theme preview gruvbox     # mostra a status line com dados de exemplo
```

Temas embutidos: `midnight` (padrão), `dracula`, `nord`, `tokyo-night`, `catppuccin`, `gruvbox`, `one-dark`, `monokai`, `solarized` e `terminal-classic`.

## Personalizar sem criar um tema

Use `theme.overrides` no `config.json`. Vale para qualquer chave de `palette` e `style`:

```powershell
td config set theme.overrides.palette.primary "#ff8800"
td config set theme.overrides.style.bar.width 12
td config set theme.overrides.style.border square
```

Ou edite direto com `td config edit`:

```json
{
  "theme": {
    "name": "dracula",
    "overrides": {
      "palette": { "accent": "#00e5ff", "warning": "#ffb86c" },
      "style": {
        "bar": { "filled": "█", "empty": "░", "width": 8 },
        "separator": "  ",
        "border": "heavy",
        "thresholds": { "warning": 50, "error": 80 }
      }
    }
  }
}
```

| Chave | Valores |
|---|---|
| `palette.background`, `foreground`, `primary`, `secondary`, `accent`, `success`, `warning`, `error`, `muted`, `surface` | `#rrggbb` |
| `ansi.*` | As 16 cores ANSI (usadas no Windows Terminal e no VS Code) |
| `style.bar.filled` / `empty` / `width` | Caracteres da barra e largura (3 a 40) |
| `style.separator` | Texto entre os grupos (padrão ` │ `) |
| `style.border` | `rounded`, `square`, `heavy`, `double`, `ascii`, `none` (bordas do painel `td`) |
| `style.thresholds.warning` / `error` | Percentual em que a barra fica amarela ou vermelha |

## Criar, exportar e importar

```powershell
td theme export dracula meu-tema.json --as meu-tema   # inclui as suas personalizações
# edite meu-tema.json
td theme import meu-tema.json                         # instala em %APPDATA%\TerminalDesign\themes
td theme set meu-tema
```

O formato está em [`themes/theme.schema.json`](../themes/theme.schema.json). Editores com suporte a JSON Schema completam e validam o arquivo enquanto você digita. Um tema do usuário com o mesmo nome de um embutido toma o lugar dele.

## Windows Terminal

`td theme wt` grava todos os temas como esquemas de cores em um [fragmento JSON](https://learn.microsoft.com/windows/terminal/json-fragment-extensions) (`%LOCALAPPDATA%\Microsoft\Windows Terminal\Fragments\TerminalDesign`). O `settings.json` do Windows Terminal **não é alterado**. Para usar, escolha `TD <tema>` em Configurações > Perfil > Aparência > Esquema de cores.

## VS Code

```powershell
td theme export tokyo-night vscode-terminal.json --vscode
```

O comando gera um bloco `workbench.colorCustomizations` com as cores do terminal integrado. Cole esse bloco no `settings.json` do VS Code. O td não altera esse arquivo sozinho porque ele costuma ter comentários seus.

## Contribuir com um tema

Abra uma issue com o template "Tema novo" ou mande um PR adicionando `themes/<nome>.json`. Os campos `license` e `source` são obrigatórios e o `npm run lint` recusa o tema sem eles. Não são aceitas paletas sem origem e licença claras.
