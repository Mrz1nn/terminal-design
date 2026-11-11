# Changelog

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [versionamento semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

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
