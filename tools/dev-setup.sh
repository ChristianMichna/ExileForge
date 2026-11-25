#!/usr/bin/env bash
# One command to make a checkout ready for work: Node deps, Playwright browser,
# headless Path of Building (PoB + LuaJIT) and the TypeScript language server
# for Claude Code's typescript-lsp plugin. Idempotent: finished steps are skipped.
#
# Used by: Claude Code cloud environment setup script, .devcontainer, humans.
# Linux/macOS/WSL. Native Windows: tools/dev-setup.ps1.
#
#   tools/dev-setup.sh            everything
#   tools/dev-setup.sh --no-pob   skip PoB (no C compiler needed)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WITH_POB=1
for a in "$@"; do
  case "$a" in
    --no-pob) WITH_POB=0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }

# --- Node + pnpm --------------------------------------------------------------
step "Node"
if ! command -v node >/dev/null; then
  echo "Node.js $(cat .nvmrc) is required (https://nodejs.org or nvm)." >&2
  exit 1
fi
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt "$(cat .nvmrc)" ]; then
  echo "Node $(node -v) is too old; need $(cat .nvmrc)+." >&2
  exit 1
fi
node -v

step "pnpm"
pnpm_want="$(node -p 'require("./package.json").packageManager.split("@")[1]')"
if [ "$(pnpm -v 2>/dev/null || true)" != "$pnpm_want" ]; then
  if command -v corepack >/dev/null && corepack enable 2>/dev/null; then
    corepack prepare "pnpm@$pnpm_want" --activate >/dev/null
  else
    npm install -g "pnpm@$pnpm_want" >/dev/null
  fi
fi
pnpm -v

step "Dependencies"
# Skip when node_modules already matches the lockfile (hash kept inside node_modules).
stamp=node_modules/.dev-setup.sha256
if sha256sum --check --status "$stamp" 2>/dev/null; then
  echo "up to date"
else
  rm -f "$stamp"
  pnpm install --frozen-lockfile
  shopt -s nullglob
  sha256sum pnpm-lock.yaml package.json apps/*/package.json packages/*/package.json > "$stamp" || rm -f "$stamp"
  shopt -u nullglob
fi

# --- Playwright browser -------------------------------------------------------
step "Playwright Chromium"
if [ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ] && [ -d "$PLAYWRIGHT_BROWSERS_PATH" ] && ls "$PLAYWRIGHT_BROWSERS_PATH" | grep -q '^chromium'; then
  echo "preinstalled in $PLAYWRIGHT_BROWSERS_PATH"
else
  # ASTROLABE_PLAYWRIGHT_DEPS=1 also installs the system libraries (needs root/sudo),
  # set by .devcontainer.
  deps=()
  [ "${ASTROLABE_PLAYWRIGHT_DEPS:-0}" = 1 ] && deps=(--with-deps)
  pnpm --filter @astrolabe/web exec playwright install "${deps[@]}" chromium
fi

# --- TypeScript language server (Claude Code plugin typescript-lsp) -----------
step "typescript-language-server"
if command -v typescript-language-server >/dev/null; then
  echo "present"
else
  npm install -g typescript-language-server typescript >/dev/null && echo "installed"
fi

# --- Headless Path of Building ------------------------------------------------
step "Path of Building (headless)"
if [ "$WITH_POB" = 0 ]; then
  echo "skipped (--no-pob)"
elif [ ! -f tools/setup_pob.sh ]; then
  echo "skipped: tools/setup_pob.sh not in this checkout yet (PoB bridge, PR #2)"
else
  pob_ref="$(sed -n 's/^POB_REF="\${POB_REF:-\([0-9a-f]*\)}".*/\1/p' tools/setup_pob.sh)"
  if [ -x .pob/luajit ] && [ "$(cat .pob/.ref 2>/dev/null || true)" = "$pob_ref" ]; then
    echo "up to date ($pob_ref)"
  else
    for tool in git make cc python3; do
      command -v "$tool" >/dev/null || { echo "missing $tool (needed to build LuaJIT)" >&2; exit 1; }
    done
    tools/setup_pob.sh
    echo "$pob_ref" > .pob/.ref
  fi
fi

step "Ready"
echo "pnpm check     typecheck, lint, format, tests, build"
echo "pnpm e2e       Playwright screenshot tests"
echo "python tools/golden_builds.py check    golden builds against PoB"
