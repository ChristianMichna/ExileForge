import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CalcServiceError } from "./errors.ts";

/** The Lua side of the worker, shipped with this package. */
export const WORKER_LUA = fileURLToPath(new URL("../lua/worker.lua", import.meta.url));

/** Everything needed to start a PoB worker process. */
export interface PobInstall {
  /** PoB-PoE2 src/ directory (contains HeadlessWrapper.lua); the worker's cwd. */
  srcDir: string;
  /** LuaJIT executable. */
  luajit: string;
  /** LUA_CPATH entry for lua-utf8 on non-Windows systems. */
  cpath?: string;
  /** Lua entry point; defaults to this package's lua/worker.lua. */
  workerLua?: string;
}

/**
 * Layout created by tools/setup_pob.sh (Linux/macOS) or the Windows setup:
 * on Windows luajit.exe sits next to PoB's own lua51.dll and lua-utf8.dll in
 * runtime/. EXILEFORGE_LUAJIT overrides the LuaJIT path.
 */
export function pobInstallFromHome(pobHome: string): PobInstall {
  const home = resolve(pobHome);
  const srcDir = join(home, "PathOfBuilding-PoE2", "src");
  const override = process.env.EXILEFORGE_LUAJIT;
  if (process.platform === "win32") {
    return {
      srcDir,
      luajit: override ?? join(home, "PathOfBuilding-PoE2", "runtime", "luajit.exe"),
    };
  }
  return { srcDir, luajit: override ?? join(home, "luajit"), cpath: join(home, "lib", "?.so") };
}

/** Throws a readable error when the PoB install is incomplete. */
export async function assertPobInstall(install: PobInstall): Promise<void> {
  const checks: [string, string][] = [
    [install.luajit, "LuaJIT"],
    [join(install.srcDir, "HeadlessWrapper.lua"), "PoB HeadlessWrapper.lua"],
    [install.workerLua ?? WORKER_LUA, "calc worker Lua entry"],
  ];
  for (const [path, what] of checks) {
    try {
      await access(path);
    } catch (cause) {
      throw new CalcServiceError(
        "worker_crashed",
        `${what} not found`,
        `${path} (run tools/setup_pob.sh)`,
        { cause },
      );
    }
  }
}

export function workerLuaDir(install: PobInstall): string {
  return dirname(install.workerLua ?? WORKER_LUA);
}
