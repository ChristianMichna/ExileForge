#!/usr/bin/env bash
# Sets up everything needed to run Path of Building (PoE2) headless.
#
# Installs into ./.pob (git-ignored):
#   .pob/PathOfBuilding-PoE2   PoB sources at a pinned commit
#   .pob/luajit                LuaJIT built from the same commit PoB itself uses
#   .pob/lib/lua-utf8.so       the only native Lua module PoB needs headless
#
# Requirements: git, make, a C compiler (gcc/cc). Linux or macOS.
# Windows: run inside WSL (see docs/pob-headless.md).
set -euo pipefail

# --- pinned versions (update together, see docs/pob-headless.md) -------------
POB_REPO="https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2.git"
POB_REF="${POB_REF:-601768bd105869618c3d6581b883e5d7aeec91b2}"   # PoB-PoE2 v0.23.1 (2026-11-10)
LUAJIT_REPO="https://github.com/LuaJIT/LuaJIT.git"
# Must match PoB's SimpleGraphic vcpkg port: PoB uses newer LuaJIT syntax
# (`x += 1`, `a?.b`) that older LuaJIT builds (e.g. distro packages) reject.
LUAJIT_REF="2460b3ff93a1c955de3d62cfc825de7d68dc272e"            # 2026-07-20
LUAUTF8_REPO="https://github.com/starwing/luautf8.git"
LUAUTF8_REF="0.1.6"
# -----------------------------------------------------------------------------

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/.pob"
mkdir -p "$DEST/lib"
CC="${CC:-cc}"

checkout() { # repo ref dir  (shallow: only the pinned commit, no history)
	if [ ! -d "$3/.git" ]; then
		git init --quiet "$3"
		git -C "$3" remote add origin "$1"
	fi
	git -C "$3" fetch --quiet --depth 1 origin "$2"
	git -C "$3" checkout --quiet --force FETCH_HEAD
}

echo "==> Path of Building (PoE2) @ $POB_REF"
checkout "$POB_REPO" "$POB_REF" "$DEST/PathOfBuilding-PoE2"

echo "==> LuaJIT @ $LUAJIT_REF"
checkout "$LUAJIT_REPO" "$LUAJIT_REF" "$DEST/luajit-src"
make -C "$DEST/luajit-src" -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)" >/dev/null
cp "$DEST/luajit-src/src/luajit" "$DEST/luajit"

echo "==> lua-utf8 @ $LUAUTF8_REF"
checkout "$LUAUTF8_REPO" "$LUAUTF8_REF" "$DEST/luautf8-src"
SHARED_FLAGS="-shared -fPIC"
if [ "$(uname)" = "Darwin" ]; then SHARED_FLAGS="-bundle -undefined dynamic_lookup"; fi
# shellcheck disable=SC2086
"$CC" -O2 $SHARED_FLAGS -I"$DEST/luajit-src/src" \
	"$DEST/luautf8-src/lutf8lib.c" -o "$DEST/lib/lua-utf8.so"

echo "==> Smoke test"
cd "$ROOT"
python3 -m pob_bridge --pob-home "$DEST" sample "Fireball 20/0  1" --out "$DEST/sample_build.xml" >/dev/null
echo "OK: Path of Building runs headless. Try: python3 -m pob_bridge stats <build code>"
