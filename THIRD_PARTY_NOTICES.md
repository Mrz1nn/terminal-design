# Avisos de terceiros

O código do Terminal-Design é MIT. Ele **não tem dependências npm em tempo de execução**: usa só o Node.js e os recursos do próprio Windows (PowerShell, `tar.exe`, winmm, user32).

## Paletas de cores dos temas

Os arquivos em `themes/` reproduzem apenas valores de cores (hex). Nenhum código, arquivo ou logo dos projetos originais foi copiado. Mesmo assim, cada tema credita a origem e a licença do projeto que publicou a paleta.

| Tema | Origem da paleta | Licença do projeto original |
|---|---|---|
| Midnight | Terminal-Design | MIT |
| Dracula | Zeno Rocha, github.com/dracula/dracula-theme | MIT |
| Nord | Arctic Ice Studio / Sven Greb, github.com/nordtheme/nord | MIT |
| Tokyo Night | enkia, github.com/enkia/tokyo-night-vscode-theme | MIT |
| Catppuccin (Mocha) | github.com/catppuccin/catppuccin | MIT |
| Gruvbox (Dark) | Pavel Pertsev, github.com/morhetz/gruvbox | MIT |
| One Dark | Atom / GitHub, github.com/atom/atom | MIT |
| Monokai Classic | Wimer Hazenberg, monokai.nl (paleta original de 2006) | Nenhuma licença formal de código. Usamos só os valores das cores. Não é o "Monokai Pro", que é um produto comercial. |
| Solarized (Dark) | Ethan Schoonover, github.com/altercation/solarized | MIT |
| Terminal Classic | Cores ANSI do esquema Campbell, github.com/microsoft/terminal | MIT |

Os nomes Dracula, Nord, Catppuccin, Gruvbox, Solarized e Monokai pertencem aos seus autores. Eles aparecem aqui só para identificar a paleta e não indicam endosso.

## Componentes baixados sob demanda (Voice Engine)

Nada disso vem dentro do repositório. Os arquivos só são baixados por `td voice setup`, depois de uma confirmação explícita.

| Componente | Fonte | Licença |
|---|---|---|
| whisper.cpp (binários para Windows) | github.com/ggml-org/whisper.cpp | MIT |
| Modelos ggml do Whisper | huggingface.co/ggerganov/whisper.cpp, convertidos dos pesos do OpenAI Whisper | MIT (OpenAI Whisper) |

Os detalhes e os hashes de verificação estão em `docs/voice.md`.

## Ferramentas de CI (não distribuídas)

As actions do GitHub usadas em `.github/workflows` estão listadas no próprio workflow, com a licença de cada uma.
