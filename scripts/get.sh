#!/bin/sh
# Terminal-Design: instalação completa em uma linha (macOS Intel/Apple Silicon, Linux x64/arm64).
#
#   curl -fsSL https://raw.githubusercontent.com/Mrz1nn/terminal-design/main/scripts/get.sh | sh
#
# Opções (com pipe, use variáveis de ambiente):
#   --no-claude   / TD_NO_CLAUDE=1   não configura a status line do Claude Code
#   --no-voice    / TD_NO_VOICE=1    (digitação por voz ainda não existe no macOS/Linux)
#   --theme=nome  / TD_THEME=nome    tema inicial
#   --no-path     / TD_NO_PATH=1     não mexe nos arquivos de perfil do shell
#   exemplo: curl -fsSL .../get.sh | TD_THEME=nord sh
#            curl -fsSL .../get.sh | sh -s -- --theme=nord --no-claude
#
# O que acontece:
#   1. Node.js 18.17+: usa o seu; se faltar ou for antigo, baixa o Node.js LTS oficial de
#      nodejs.org, confere o SHA-256 e coloca em ~/.local/share/terminal-design/node
#      (sem sudo, nada do sistema é alterado).
#   2. Baixa a última release do GitHub, confere o SHA-256 e só então extrai.
#   3. Roda scripts/install.sh da release (com --claude-code, a menos que --no-claude).
# Nada baixado é executado antes da verificação do checksum.
#
# Variáveis para testes/CI (não use no dia a dia):
#   TD_RELEASE_BASE_URL   pasta das releases (padrão: .../releases/latest/download)
#   TD_RELEASE_ZIP + TD_RELEASE_SUMS   zip e SHA256SUMS.txt locais (scripts/pack-release.js)
#   TD_NODE_DIST_URL      pasta de distribuição do Node.js (padrão: nodejs.org latest-v22.x)
#   TD_FORCE_NODE_DOWNLOAD=1   baixa o Node.js mesmo havendo um no PATH
#   URLs podem ser https://, file:// ou caminhos locais.

# The whole script is one function called on the last line, so a truncated download
# never runs half of it.
td_get_main() {
  set -eu

  td_repo=Mrz1nn/terminal-design
  td_release_base=${TD_RELEASE_BASE_URL:-https://github.com/$td_repo/releases/latest/download}
  td_node_dist=${TD_NODE_DIST_URL:-https://nodejs.org/dist/latest-v22.x}
  td_no_claude=${TD_NO_CLAUDE:-0}
  td_no_voice=${TD_NO_VOICE:-0}
  td_no_path=${TD_NO_PATH:-0}
  td_theme=${TD_THEME:-}

  for td_arg in "$@"; do
    case "$td_arg" in
      --no-claude) td_no_claude=1 ;;
      --no-voice) td_no_voice=1 ;;
      --no-path) td_no_path=1 ;;
      --theme=*) td_theme=${td_arg#--theme=} ;;
      -h|--help)
        printf 'Uso: curl -fsSL https://raw.githubusercontent.com/%s/main/scripts/get.sh | sh -s -- [--no-claude] [--no-voice] [--no-path] [--theme=nome]\n' "$td_repo"
        return 0 ;;
      *) td_fail "opção desconhecida: $td_arg" ;;
    esac
  done

  td_data_home=${TD_DATA_HOME:-$HOME/.local/share/terminal-design}

  td_tmp=$(mktemp -d "${TMPDIR:-/tmp}/terminal-design.XXXXXX") || td_fail 'não foi possível criar uma pasta temporária'
  trap 'rm -rf "$td_tmp"' EXIT
  trap 'rm -rf "$td_tmp"; exit 130' INT TERM

  printf '\nTerminal-Design: instalação completa\n\n'

  # ---- 1. Node.js -------------------------------------------------------------
  td_node=
  td_node_note=
  if [ "${TD_FORCE_NODE_DOWNLOAD:-0}" != 1 ]; then
    for td_cand in "${TD_NODE:-}" "$td_data_home/node/bin/node" "$(command -v node 2>/dev/null || true)"; do
      if [ -n "$td_cand" ] && [ -x "$td_cand" ] && td_node_ok "$td_cand"; then td_node=$td_cand; break; fi
    done
  fi
  if [ -n "$td_node" ]; then
    td_node_note="Node.js $("$td_node" -p 'process.versions.node') ($td_node)"
    td_step "Node.js encontrado: $td_node_note"
  else
    td_install_node
    td_node_note="Node.js $("$td_node" -p 'process.versions.node') baixado de nodejs.org para $td_data_home/node"
  fi

  # ---- 2. release -------------------------------------------------------------
  td_sums="$td_tmp/SHA256SUMS.txt"
  if [ -n "${TD_RELEASE_SUMS:-}" ]; then td_fetch "$TD_RELEASE_SUMS" "$td_sums"; else td_fetch "$td_release_base/SHA256SUMS.txt" "$td_sums"; fi
  td_zip_name=$(sed -n 's/^[0-9a-fA-F]\{64\}[ *][ *]*\(terminal-design-[0-9][0-9A-Za-z.+-]*\.zip\)[[:space:]]*$/\1/p' "$td_sums" | head -n 1)
  td_zip_hash=$(sed -n 's/^\([0-9a-fA-F]\{64\}\)[ *][ *]*terminal-design-[0-9][0-9A-Za-z.+-]*\.zip[[:space:]]*$/\1/p' "$td_sums" | head -n 1)
  [ -n "$td_zip_name" ] && [ -n "$td_zip_hash" ] || td_fail 'o SHA256SUMS.txt da release não lista o pacote terminal-design-<versão>.zip'
  td_zip="$td_tmp/$td_zip_name"
  if [ -n "${TD_RELEASE_ZIP:-}" ]; then td_fetch "$TD_RELEASE_ZIP" "$td_zip"; else td_fetch "$td_release_base/$td_zip_name" "$td_zip"; fi
  td_verify "$td_zip" "$td_zip_hash"
  td_step "$td_zip_name baixado e conferido (SHA-256)"

  td_x="$td_tmp/release"
  mkdir -p "$td_x"
  td_unzip "$td_zip" "$td_x"
  td_root=
  for td_d in "$td_x"/terminal-design-* "$td_x"; do
    if [ -f "$td_d/scripts/install.sh" ] && [ -f "$td_d/package.json" ]; then td_root=$td_d; break; fi
  done
  [ -n "$td_root" ] || td_fail 'o pacote baixado não tem scripts/install.sh'

  # ---- 3. install -------------------------------------------------------------
  set -- "$td_root/scripts/install.sh"
  if [ "$td_no_claude" != 1 ]; then set -- "$@" --claude-code; fi
  if [ "$td_no_path" = 1 ]; then set -- "$@" --no-path; fi
  if [ -n "$td_theme" ]; then set -- "$@" "--theme=$td_theme"; fi
  TD_NODE=$td_node sh "$@" || td_fail 'o instalador terminou com erro (veja acima)'

  # ---- summary ----------------------------------------------------------------
  printf '\n────────────────────────────────────────\n'
  printf 'Terminal-Design instalado.\n'
  printf '  • programa: %s\n' "$td_data_home"
  printf '  • %s\n' "$td_node_note"
  if [ "$td_no_claude" = 1 ]; then printf '  • Claude Code: não configurado (rode depois: td claude install)\n'
  else printf '  • Claude Code: status line configurada\n'; fi
  if [ "$td_no_voice" != 1 ]; then printf '  • voz: ainda não disponível no macOS/Linux (só no Windows por enquanto)\n'; fi
  if [ "$td_no_path" = 1 ]; then printf '\nPronto. Rode: "%s/bin/td"\n' "$td_data_home"
  else printf '\nPronto. Abra um terminal novo e digite td\n'; fi
}

td_fail() {
  printf '✗ %s\n' "$1" >&2
  exit 1
}

td_step() {
  printf '  › %s\n' "$1"
}

# td_node_ok <node>: true when it runs and is >= 18.17
td_node_ok() {
  td_v=$("$1" -p 'process.versions.node' 2>/dev/null) || return 1
  td_major=${td_v%%.*}
  td_rest=${td_v#*.}
  td_minor=${td_rest%%.*}
  case "$td_major$td_minor" in *[!0-9]*|'') return 1 ;; esac
  [ "$td_major" -gt 18 ] || { [ "$td_major" -eq 18 ] && [ "$td_minor" -ge 17 ]; }
}

# td_fetch <url|file://|path> <dest>
td_fetch() {
  case "$1" in
    https://*)
      if command -v curl >/dev/null 2>&1; then
        curl -fsSL --proto '=https' --tlsv1.2 --retry 2 --connect-timeout 20 -o "$2" "$1" || td_fail "falha ao baixar $1"
      elif command -v wget >/dev/null 2>&1; then
        wget -q -O "$2" "$1" || td_fail "falha ao baixar $1"
      else
        td_fail 'preciso de curl ou wget para baixar'
      fi ;;
    http://*) td_fail "recusado: só HTTPS é permitido ($1)" ;;
    file://*) cp "${1#file://}" "$2" || td_fail "arquivo não encontrado: $1" ;;
    *) cp "$1" "$2" || td_fail "arquivo não encontrado: $1" ;;
  esac
}

td_sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha256 "$1" | awk '{print $NF}'
  else td_fail 'preciso de shasum, sha256sum ou openssl para conferir o download'
  fi
}

# td_verify <file> <expected hex>
td_verify() {
  td_actual=$(td_sha256 "$1" | tr 'A-F' 'a-f')
  td_expected=$(printf '%s' "$2" | tr 'A-F' 'a-f')
  if [ "$td_actual" != "$td_expected" ]; then
    rm -f "$1"
    td_fail "SHA-256 não confere para $(basename "$1"); download recusado"
  fi
}

# td_unzip <zip> <dest>: refuses absolute names and "..", then extracts
td_unzip() {
  if command -v unzip >/dev/null 2>&1; then
    if unzip -Z1 "$1" | grep -E '(^/|(^|/)\.\.(/|$)|\\)' >/dev/null 2>&1; then td_fail 'o pacote tem caminhos inseguros; recusado'; fi
    unzip -q "$1" -d "$2" || td_fail 'falha ao extrair o pacote'
  elif command -v ditto >/dev/null 2>&1; then
    ditto -x -k "$1" "$2" || td_fail 'falha ao extrair o pacote'
  elif command -v python3 >/dev/null 2>&1; then
    python3 -I -m zipfile -e "$1" "$2" || td_fail 'falha ao extrair o pacote'
  elif command -v bsdtar >/dev/null 2>&1; then
    bsdtar -xf "$1" -C "$2" || td_fail 'falha ao extrair o pacote'
  else
    td_fail 'preciso de unzip para extrair o pacote (ex.: sudo apt install unzip)'
  fi
}

td_install_node() {
  case "$(uname -s)" in
    Darwin) td_os=darwin ;;
    Linux) td_os=linux ;;
    *) td_fail "sistema não suportado para baixar o Node.js automaticamente: $(uname -s). Instale o Node.js 18.17+ e rode de novo." ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) td_arch=x64 ;;
    arm64|aarch64) td_arch=arm64 ;;
    *) td_fail "arquitetura não suportada para baixar o Node.js: $(uname -m)" ;;
  esac
  # A shell running under Rosetta reports x86_64 on Apple Silicon: prefer the native build.
  if [ "$td_os" = darwin ] && [ "$td_arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then td_arch=arm64; fi

  td_step "Node.js 18.17+ não encontrado; baixando o Node.js LTS oficial ($td_os-$td_arch)…"
  td_node_sums="$td_tmp/node-SHASUMS256.txt"
  td_fetch "$td_node_dist/SHASUMS256.txt" "$td_node_sums"
  td_node_file=$(sed -n "s/^[0-9a-f]\{64\}  *\(node-v[0-9][0-9.]*-$td_os-$td_arch\.tar\.gz\)\$/\1/p" "$td_node_sums" | head -n 1)
  td_node_hash=$(sed -n "s/^\([0-9a-f]\{64\}\)  *node-v[0-9][0-9.]*-$td_os-$td_arch\.tar\.gz\$/\1/p" "$td_node_sums" | head -n 1)
  [ -n "$td_node_file" ] && [ -n "$td_node_hash" ] || td_fail "não achei o Node.js para $td_os-$td_arch em $td_node_dist"
  td_node_tgz="$td_tmp/$td_node_file"
  td_fetch "$td_node_dist/$td_node_file" "$td_node_tgz"
  td_verify "$td_node_tgz" "$td_node_hash"
  td_step "$td_node_file conferido (SHA-256)"

  td_nx="$td_tmp/node-x"
  mkdir -p "$td_nx"
  tar -xzf "$td_node_tgz" -C "$td_nx" || td_fail 'falha ao extrair o Node.js'
  td_node_src="$td_nx/${td_node_file%.tar.gz}"
  [ -x "$td_node_src/bin/node" ] || td_fail 'o pacote do Node.js não tem bin/node'

  mkdir -p "$td_data_home"
  if [ -e "$td_data_home/node" ]; then
    rm -rf "$td_data_home/node.old"
    mv "$td_data_home/node" "$td_data_home/node.old"
  fi
  mv "$td_node_src" "$td_data_home/node"
  rm -rf "$td_data_home/node.old"
  td_node="$td_data_home/node/bin/node"
  td_node_ok "$td_node" || td_fail 'o Node.js baixado não funciona neste sistema'
  td_step "Node.js $("$td_node" -p 'process.versions.node') instalado em $td_data_home/node"
}

td_get_main "$@"
