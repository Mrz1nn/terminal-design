# Arquitetura

## Princípios

1. **Os módulos são independentes.** O cockpit, os temas, o atualizador e a voz funcionam sozinhos. Eles só têm em comum `packages/core` e `packages/config`.
2. **Tema é dado, não código.** Um tema é um JSON. Os widgets pedem cores ao *painter* (`apps/terminal-cockpit/src/paint.js`) e não sabem qual tema está ativo.
3. **As três zonas de arquivos nunca se misturam** (`packages/core/src/paths.js`):

| Zona | Windows | Conteúdo | Quem escreve |
|---|---|---|---|
| Programa (`appRoot`) | `%LOCALAPPDATA%\TerminalDesign\versions\<v>` | Código | Só o instalador e o `td update` |
| Configuração (`configHome`) | `%APPDATA%\TerminalDesign` | `config.json` e `themes\` do usuário | Só o usuário e os comandos `td config` e `td theme` (sempre com backup antes) |
| Dados (`dataHome`) | `%LOCALAPPDATA%\TerminalDesign` | `versions\`, `backups\`, `cache\`, `voice\`, `launcher.js`, `bin\` | O próprio td |

   As variáveis `TD_CONFIG_HOME` e `TD_DATA_HOME` mudam esses caminhos. Os testes usam isso para nunca tocar nos arquivos reais.
4. **Nenhuma métrica é inventada.** `apps/terminal-cockpit/src/data.js` converte o payload oficial em um formato estável. O que não existe fica `null`.
5. **Escritas são atômicas e precedidas de backup.** Todo arquivo é gravado em um temporário e depois renomeado. Todo arquivo de outro programa (por exemplo, o `settings.json` do Claude Code) é copiado para `backups\` antes de mudar.

## Fluxo da status line

```
Claude Code ──stdin JSON──▶ launcher.js ──▶ versions/<v>/bin/td.js statusline
                                               │
                         loadConfig ◀──────────┤
                         resolveTheme ◀────────┤
                         normalize(payload) ───┤
                         readGit (cache 3s) ───┤
                         widgets → linhas ─────┴──▶ stdout (ANSI, até 3 linhas)
```

- **Widgets** (`widgets.js`): cada um tem `{ id, group, priority, render(d, ctx) }` e devolve um texto ou `null`.
- **Layouts**: `compact`, `cockpit` e `full`, ou linhas personalizadas em `cockpit.rows`.
- **Largura**: usa o `COLUMNS` informado pelo Claude Code. Se a linha não couber, os widgets de menor prioridade são removidos primeiro.
- **Falhas**: um widget que lança erro é ignorado e o resto da linha continua.

## Registro de módulos (ponto de extensão para plugins)

`packages/core/src/registry.js` guarda módulos dos tipos `command`, `widget` e `integration`. Hoje só os módulos embutidos se registram. Um sistema de plugins no futuro só precisa carregar arquivos externos e chamar `register()` com o mesmo contrato. Isso foi deixado de fora de propósito por enquanto.

### Contrato de comando

```js
export default {
  id: 'theme',
  summary: 'linha do td help',
  usage: ['td theme list'],
  async run({ args, flags, ctx }) { return 0; },
  async doctor(ctx) { return [{ name, ok: true | false | null, detail }]; }, // opcional
};
```

`ctx` contém `{ paths, config, theme, ui, version, mode }`. O `td doctor` junta automaticamente os `doctor()` de todos os comandos.

## Atualização

Veja [updating.md](updating.md). Em resumo: as versões ficam lado a lado em `versions\`, o `current.json` aponta a ativa e o `launcher.js` é estável. O Claude Code e o PATH sempre chamam o launcher, então trocar de versão é só reescrever o `current.json` de forma atômica, e o rollback é imediato.

## Voz

Veja [voice.md](voice.md). Um host em PowerShell 5.1 com C# compilado em tempo de execução (via `Add-Type`) cuida do atalho global, do microfone e da inserção de texto. O Node cuida da lógica e do whisper.cpp. Os dois conversam por JSON lines no stdin e no stdout.

## Decisões

| Decisão | Motivo |
|---|---|
| Node.js sem dependências | O Claude Code já exige Node. Assim não há licenças de terceiros para auditar no runtime e a instalação fica trivial. |
| PowerShell e C# via Add-Type para a voz | Já vêm em todo Windows 10 e 11. Não exige compilador, Python nem binários extras além do whisper.cpp. |
| Fragmentos JSON no Windows Terminal | É o mecanismo oficial de extensão. Nunca editamos o `settings.json` do usuário, que costuma ter comentários. |
| Snippet para o VS Code | Também evita editar um JSONC do usuário. |
| GitHub Releases com SHA256SUMS | É gratuito, versionado e verificável. |
