#!/usr/bin/env bash
# Re-renders the Playwright screenshot baselines locally in the same pinned
# container CI uses, so they match pixel for pixel. Needs Docker.
# Without Docker: add the label "screenshots-update" to the PR instead.
#
# Usage: tools/update-screenshots.sh [extra playwright args]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/apps/web/package.json').devDependencies['@playwright/test']")"
IMAGE="mcr.microsoft.com/playwright:v${VERSION}-noble"

cd "$ROOT"
pnpm build >/dev/null
# The container reuses the host's node_modules (both linux-x64); a tiny pnpm
# shim serves the built app because the image has no pnpm.
docker run --rm --network host --ipc=host -v "$ROOT":/work -w /work/apps/web "$IMAGE" bash -c '
  mkdir -p /tmp/shim
  printf "#!/bin/sh\nexec /work/apps/web/node_modules/.bin/vite preview --port 4173 --strictPort\n" > /tmp/shim/pnpm
  chmod +x /tmp/shim/pnpm
  PATH=/tmp/shim:/work/apps/web/node_modules/.bin:$PATH playwright test --update-snapshots=all "$@"
' _ "$@"
git -C "$ROOT" status --short -- 'apps/*/e2e/__screenshots__'
