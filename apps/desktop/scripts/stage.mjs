// Checks that everything electron-builder packs as extraResources exists, and
// fails with a clear message instead of building an installer that cannot start.
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const required = [
  [root("../dist/main.cjs"), "run `pnpm --filter @astrolabe/desktop build`"],
  [root("../dist/preload.cjs"), "run `pnpm --filter @astrolabe/desktop build`"],
  [root("../../web/dist/index.html"), "run `pnpm --filter @astrolabe/web build`"],
  [
    root("../../mcp-bridge/dist/astrolabe.mcpb"),
    "run `pnpm --filter @astrolabe/mcp-bridge pack:mcpb`",
  ],
  [
    root("../../../.pob/PathOfBuilding-PoE2/src/HeadlessWrapper.lua"),
    "run tools/setup_pob.sh, or fetch the pinned PoB as in .github/workflows/desktop.yml",
  ],
  [
    root("../../../.pob/PathOfBuilding-PoE2/runtime/luajit.exe"),
    "build luajit.exe next to PoB's lua51.dll (see .github/workflows/desktop.yml, tools/build_windows_luajit.sh)",
  ],
  [root("../../calc/lua/worker.lua"), "the calc worker's Lua file is part of the repository"],
  [
    root("../data-release/manifest.json"),
    "copy a data release (manifest.json + shards, e.g. data-snapshots/current/catalog) to apps/desktop/data-release",
  ],
];

const missing = [];
for (const [path, hint] of required) {
  try {
    await access(path);
  } catch {
    missing.push(`${path}\n  → ${hint}`);
  }
}
if (missing.length > 0) {
  console.error(`Cannot build the installer, missing:\n${missing.join("\n")}`);
  process.exit(1);
}
