#!/bin/bash

# Finder launches do not necessarily inherit the terminal's PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:/Library/TeX/texbin:${PATH:-/usr/bin:/bin}:/usr/sbin:/sbin"

# Reuse Codex's local Poppler bundle when system Poppler is not installed.
FIGURE_POPPLER="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/bin"
if [ -x "$FIGURE_POPPLER/pdftoppm" ] && [ -x "$FIGURE_POPPLER/pdfinfo" ]; then
  export PATH="$PATH:$FIGURE_POPPLER"
fi

pause_before_exit() {
  if [ -t 0 ]; then
    printf '\nPress Enter to close this window...'
    read -r _
  fi
}

fail() {
  printf '\nERROR: %s\n' "$1" >&2
  pause_before_exit
  exit 1
}

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)" || exit 1
SERVICE="$SCRIPT_DIR/service/render-service.mjs"
PORT="${SEMANTIC_RENDER_PORT:-8765}"
PANDOC="${PANDOC_BIN:-pandoc}"

case "$PORT" in
  ''|*[!0-9]*) fail "SEMANTIC_RENDER_PORT must be a number between 1 and 65535." ;;
esac
[ "${#PORT}" -le 5 ] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] ||
  fail "SEMANTIC_RENDER_PORT must be between 1 and 65535."

[ -f "$SERVICE" ] || fail "Service script not found: $SERVICE"
command -v node >/dev/null 2>&1 || fail "Node.js is missing. Install Node.js first."
command -v "$PANDOC" >/dev/null 2>&1 || fail "Pandoc is missing: $PANDOC"
command -v xelatex >/dev/null 2>&1 || fail "XeLaTeX is missing. Install a TeX distribution with Chinese support."
command -v kpsewhich >/dev/null 2>&1 || fail "kpsewhich is missing. Check your TeX installation."
[ -n "$(kpsewhich ctexart.cls)" ] || fail "ctexart.cls is missing. Install the ctex package."

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  printf '\nPort %s is already in use:\n' "$PORT"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
  fail "If this is the PDF renderer, reuse it. Otherwise resolve the port conflict. No process was stopped."
fi

cd "$SCRIPT_DIR" || fail "Cannot open the project directory."
printf '\nStarting the PDF renderer...\n'
printf 'Zotero render service address: http://127.0.0.1:%s\n' "$PORT"
printf 'Keep this window open. Press Ctrl+C to stop the service.\n\n'
node "$SERVICE"
RESULT=$?
printf '\nRenderer stopped (exit code %s).\n' "$RESULT"
pause_before_exit
exit "$RESULT"
