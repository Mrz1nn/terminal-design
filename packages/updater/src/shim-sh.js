// bin/td for macOS, Linux and Git Bash. POSIX sh (works with dash, bash 3.2, zsh as sh).
//
// It has to find node even when it runs in a bare non-interactive shell (for example the
// Claude Code status line on macOS, started without the user's profile, so no nvm or
// Homebrew in PATH). Search order:
//   1. $TD_NODE
//   2. the node that ran the installer (absolute path recorded below), if it still exists
//   3. command -v node
//   4. /opt/homebrew/bin/node, /usr/local/bin/node
//   5. ~/.volta/bin/node
//   6. newest ~/.nvm/versions/node/*/bin/node
//   7. fnm default alias (~/.local/share/fnm, ~/Library/Application Support/fnm, $FNM_DIR)
import { shQuote } from './pathenv.js';

export function renderShimSh({ recordedNode = '' } = {}) {
  const head = [
    '#!/bin/sh',
    '# Terminal-Design: atalho gerado pelo instalador. Nao edite (e reescrito a cada instalacao).',
    `TD_RECORDED_NODE=${shQuote(recordedNode || '')}`,
  ].join('\n');
  const body = String.raw`
td_self=$(printf '%s' "$0" | sed -e 's,\\,/,g')
td_dir=$(CDPATH= cd -- "$(dirname -- "$td_self")" && pwd)
td_launcher="$td_dir/../launcher.js"
td_node=

td_try() {
  if [ -z "$td_node" ] && [ -n "$1" ] && [ -f "$1" ] && [ -x "$1" ]; then td_node=$1; fi
}

td_try "$TD_NODE"
td_try "$TD_RECORDED_NODE"
if [ -z "$td_node" ]; then
  td_found=$(command -v node 2>/dev/null || true)
  case "$td_found" in /*) td_try "$td_found" ;; esac
fi
td_try /opt/homebrew/bin/node
td_try /usr/local/bin/node
td_try "$HOME/.volta/bin/node"
if [ -z "$td_node" ] && [ -d "$HOME/.nvm/versions/node" ]; then
  td_nvm=$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sed -n 's/^v\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)$/\1/p' | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
  if [ -n "$td_nvm" ]; then td_try "$HOME/.nvm/versions/node/v$td_nvm/bin/node"; fi
fi
for td_fnm in "$FNM_DIR" "$HOME/.local/share/fnm" "$HOME/Library/Application Support/fnm" "$HOME/.fnm"; do
  if [ -n "$td_fnm" ]; then td_try "$td_fnm/aliases/default/bin/node"; fi
done

if [ -z "$td_node" ]; then
  echo "Terminal-Design: Node.js 18.17+ nao encontrado." >&2
  echo "  Instale em https://nodejs.org/pt-br/download (no macOS: brew install node)" >&2
  echo "  ou aponte TD_NODE para o executavel do node." >&2
  exit 127
fi
exec "$td_node" "$td_launcher" "$@"
`;
  return `${head}${body}`;
}
