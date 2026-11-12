#!/bin/sh
# Terminal-Design: instalador para macOS e Linux. POSIX sh (funciona com /bin/sh do macOS,
# bash 3.2 e zsh). Rode sempre com sh, assim funciona mesmo sem permissao de execucao:
#
#   sh scripts/install.sh [--theme=<nome>] [--claude-code] [--no-path]
#
# Copia o programa para ~/.local/share/terminal-design/versions/<versao>, cria o launcher,
# o atalho bin/td e o current.json, adiciona bin ao PATH com um bloco marcado no ~/.zshrc
# (e no ~/.bash_profile ou ~/.bashrc, se existir) e roda `td doctor`. A configuracao em
# ~/.config/terminal-design so e criada se nao existir. Pode rodar de novo quando quiser.
#
# Node.js: usa $TD_NODE se estiver definido, senao o `node` do PATH. O caminho desse node
# fica gravado no atalho, para a status line achar o node mesmo sem o seu PATH.

set -eu

usage() {
  cat <<'USAGE'
Uso: sh scripts/install.sh [opções]

  --theme=<nome>   define o tema (ex.: midnight, dracula, nord)
  --claude-code    também instala a status line no Claude Code (td claude install)
  --no-path        não mexe nos arquivos de perfil do shell (PATH)
  -h, --help       mostra esta ajuda

Para escolher o Node.js usado: TD_NODE=/caminho/do/node sh scripts/install.sh
USAGE
}

fail() {
  printf '✗ %s\n' "$1" >&2
  exit 1
}

warn() {
  printf '! %s\n' "$1" >&2
}

theme=
claude=0
nopath=0
for arg in "$@"; do
  case "$arg" in
    --theme=*) theme=${arg#--theme=} ;;
    --claude-code) claude=1 ;;
    --no-path) nopath=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; fail "opção desconhecida: $arg" ;;
  esac
done

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo=$(dirname -- "$script_dir")

printf '\nTerminal-Design - instalação\n'

if [ ! -f "$repo/package.json" ] || [ ! -f "$repo/packages/updater/src/installer.js" ]; then
  fail "não encontrei os arquivos do Terminal-Design em $repo. Rode de dentro da pasta do projeto: sh scripts/install.sh"
fi

node_help='Instale o Node.js 18.17 ou mais novo (LTS): https://nodejs.org/pt-br/download (no macOS também: brew install node) e abra um terminal novo.'
if [ -n "${TD_NODE:-}" ]; then
  node_bin=$TD_NODE
  [ -x "$node_bin" ] || fail "TD_NODE aponta para algo que não é um executável: $node_bin"
else
  node_bin=$(command -v node 2>/dev/null || true)
  [ -n "$node_bin" ] || fail "Node.js não encontrado. $node_help"
fi

node_version=$("$node_bin" -p 'process.versions.node' 2>/dev/null || true)
[ -n "$node_version" ] || fail "não foi possível executar o Node.js em $node_bin. $node_help"
major=${node_version%%.*}
rest=${node_version#*.}
minor=${rest%%.*}
case "$major$minor" in
  *[!0-9]*|'') fail "versão do Node.js não reconhecida: $node_version" ;;
esac
if [ "$major" -lt 18 ] || { [ "$major" -eq 18 ] && [ "$minor" -lt 17 ]; }; then
  fail "o Terminal-Design precisa do Node.js 18.17 ou mais novo (encontrado $node_version). $node_help"
fi
printf '  > Node.js %s (%s)\n' "$node_version" "$node_bin"

set -- "$repo/packages/updater/src/installer.js"
if [ "$nopath" = 1 ]; then set -- "$@" --no-path; fi
if [ -n "$theme" ]; then set -- "$@" "--theme=$theme"; fi

if ! "$node_bin" "$@"; then
  fail 'a instalação não foi concluída. A nova versão não foi ativada; a instalação anterior, se havia, continua como estava.'
fi

data_home=${TD_DATA_HOME:-$HOME/.local/share/terminal-design}
td="$data_home/bin/td"

printf '\n'
if ! sh "$td" doctor; then
  warn 'td doctor encontrou pontos de atenção (veja acima). A instalação foi feita.'
fi

if [ "$claude" = 1 ]; then
  printf '\n'
  if ! sh "$td" claude install; then
    warn 'não foi possível configurar o Claude Code agora. Rode depois: td claude install'
  fi
fi

printf '\n'
if [ "$nopath" = 1 ]; then
  printf 'Pronto. Rode: "%s"\n' "$td"
else
  printf 'Pronto. Abra um terminal novo e digite: td\n'
fi
exit 0
