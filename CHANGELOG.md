# Changelog

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [versionamento semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Segurança (Voice Engine)
- **R1:** o texto só é inserido na janela que estava em foco quando a gravação começou. Se o foco mudar antes ou durante a digitação, nada mais é digitado e o texto fica guardado para cópia manual (Enter no terminal ou menu da bandeja). O aviso aparece no overlay e no console.
- **R2:** se Ctrl, Alt, AltGr, Shift, Win ou a tecla do atalho continuarem pressionados depois de 1,5 s, a inserção é cancelada, para que nenhum atalho dispare sem querer. Toda tecla injetada é solta mesmo quando o Windows aceita só parte do envio.
- Cada gravação recebe um id e só pode ser inserida uma vez.
- A inserção agora usa a interface `IInputEnv`, testada com um ambiente falso (27 testes do host, sem digitar em janelas reais).

### Mudado
- **R3:** o atalho padrão da voz passou de `Ctrl+Alt+Space` para `Ctrl+Shift+F9`, que não conflita com o AltGr do teclado ABNT2. Atalhos `Ctrl+Alt+<tecla>` geram um aviso e são ignorados enquanto o AltGr está pressionado.

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
