#!/bin/sh
# Terminal-Design: desinstalador para macOS e Linux (atalho para `td uninstall`).
#
#   sh scripts/uninstall.sh [--yes] [--keep-config] [--purge]
#
# Remove a integração com o Claude Code (só a nossa), o bloco marcado do PATH nos arquivos
# de perfil do shell (com backup antes) e os arquivos do programa. A configuração é mantida,
# a menos que você use --purge.
set -eu

if [ -n "${TD_NODE:-}" ]; then
  node_bin=$TD_NODE
else
  node_bin=$(command -v node 2>/dev/null || true)
fi
if [ -z "$node_bin" ]; then
  printf '✗ Node.js não encontrado; ele é necessário para desinstalar com segurança. Defina TD_NODE=/caminho/do/node.\n' >&2
  exit 1
fi

data_home=${TD_DATA_HOME:-$HOME/.local/share/terminal-design}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ -f "$data_home/launcher.js" ]; then
  exec "$node_bin" "$data_home/launcher.js" uninstall "$@"
fi
exec "$node_bin" "$script_dir/../bin/td.js" uninstall "$@"
