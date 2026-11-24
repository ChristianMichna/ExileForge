#!/usr/bin/env bash
# Cross-compiles a tiny luajit.exe for Windows that uses PoB's own lua51.dll.
# EXPERIMENTAL: builds cleanly, but has NOT been run on Windows yet (see docs/pob-headless.md).
#
# PoB's Windows runtime (PathOfBuilding-PoE2/runtime/) already ships the exact
# LuaJIT it needs as lua51.dll plus lua-utf8.dll. Only the small command line
# host (luajit.c) is missing. Put the resulting luajit.exe next to lua51.dll.
#
# Needs: tools/setup_pob.sh run once (for sources), x86_64-w64-mingw32-gcc.
# Prefer a UCRT mingw toolchain or MSVC: PoB's DLLs use the UCRT.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
P="$ROOT/.pob"
"${CC_WIN:-x86_64-w64-mingw32-gcc}" -O2 -I"$P/luajit-src/src" "$P/luajit-src/src/luajit.c" \
	"$P/PathOfBuilding-PoE2/runtime/lua51.dll" -o "$P/luajit.exe"
echo "built $P/luajit.exe -> copy to PathOfBuilding-PoE2/runtime/ on Windows"
