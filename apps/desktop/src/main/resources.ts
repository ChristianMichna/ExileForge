import { readFile, stat } from "node:fs/promises";
import { compareReleaseIds, installedReleaseIds, parseReleaseId } from "@astrolabe/release-sync";
import { join } from "node:path";

export interface AppDirs {
  /** Holds web/, config/, astrolabe.mcpb and data-release/ (packaged) or the repository (dev). */
  readonly resourcesRoot: string;
  readonly webRoot: string;
  readonly forgeConfigPath: string;
  readonly stagesConfigPath: string;
  readonly desktopConfigPath: string;
  readonly extensionPath: string;
  /** Data releases the app downloaded itself: <userData>/data-releases/<release id>/ */
  readonly downloadedReleasesDir: string;
  readonly bundledReleaseDir: string;
  readonly databasePath: string;
  /** Holds PathOfBuilding-PoE2/ (src, runtime with luajit.exe): `pob/` packaged, `.pob/` in the repository. */
  readonly pobHome: string;
  /** The calc worker's Lua entry point (`calc-lua/worker.lua` packaged). */
  readonly calcWorkerLua: string;
  readonly optimizerConfigPath: string;
  /** luajit.exe of the installed app; undefined in development (PoB's own setup decides). */
  readonly luajit: string | undefined;
  /** True for the installed app, which must bring PoB. */
  readonly packaged: boolean;
}

/**
 * Folder layout. Packaged: everything sits in `process.resourcesPath` (see
 * electron-builder.yml extraResources). Development: the repository. The calc service reads
 * `config/calc` and `config/calc-profiles` below `resourcesRoot`.
 */
export function resolveAppDirs(opts: {
  packaged: boolean;
  resourcesPath: string;
  repoRoot: string;
  userData: string;
}): AppDirs {
  const root = opts.packaged ? opts.resourcesPath : opts.repoRoot;
  return {
    resourcesRoot: root,
    webRoot: opts.packaged ? join(root, "web") : join(root, "apps", "web", "dist"),
    forgeConfigPath: join(root, "config", "forge", "forge.json"),
    stagesConfigPath: join(root, "config", "agents", "stages.json"),
    desktopConfigPath: join(root, "config", "desktop", "desktop.json"),
    extensionPath: opts.packaged
      ? join(root, "astrolabe.mcpb")
      : join(root, "apps", "mcp-bridge", "dist", "astrolabe.mcpb"),
    downloadedReleasesDir: join(opts.userData, "data-releases"),
    bundledReleaseDir: opts.packaged
      ? join(root, "data-release")
      : join(root, "data-snapshots", "current", "catalog"),
    databasePath: join(opts.userData, "astrolabe.sqlite"),
    pobHome: join(root, opts.packaged ? "pob" : ".pob"),
    calcWorkerLua: opts.packaged
      ? join(root, "calc-lua", "worker.lua")
      : join(root, "apps", "calc", "lua", "worker.lua"),
    optimizerConfigPath: join(root, "config", "optimizer", "tree.json"),
    luajit: opts.packaged
      ? join(root, "pob", "PathOfBuilding-PoE2", "runtime", "luajit.exe")
      : undefined,
    packaged: opts.packaged,
  };
}

async function isRelease(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, "manifest.json"))).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error(`Cannot inspect data release folder ${dir}`, { cause: error });
  }
}

/** The release id a folder's manifest names. Throws when it is missing or not a release id. */
async function manifestId(dir: string): Promise<string> {
  let id: unknown;
  try {
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as {
      release?: { id?: unknown };
    };
    id = manifest.release?.id;
  } catch (cause) {
    throw new Error(`The data release in ${dir} has an unreadable manifest.json`, { cause });
  }
  try {
    parseReleaseId(String(id));
  } catch (cause) {
    throw new Error(`The manifest.json in ${dir} names no valid data release id`, { cause });
  }
  return String(id);
}

/**
 * Picks the data release to load: an explicit override, otherwise the newest of the downloaded
 * releases (folders named by release id) and the one bundled with the installer, by game
 * version and revision. Throws with a plain explanation when there is none; there is no empty
 * fallback catalog.
 */
export async function findDataRelease(dirs: AppDirs, override?: string): Promise<string> {
  if (override !== undefined && override !== "") {
    if (await isRelease(override)) return override;
    throw new Error(`ASTROLABE_DATA_RELEASE points to ${override}, which has no manifest.json.`);
  }
  const ids = await installedReleaseIds(dirs.downloadedReleasesDir);
  const candidates: { id: string; dir: string }[] = ids.map((id) => ({
    id,
    dir: join(dirs.downloadedReleasesDir, id),
  }));
  if (await isRelease(dirs.bundledReleaseDir)) {
    candidates.push({ id: await manifestId(dirs.bundledReleaseDir), dir: dirs.bundledReleaseDir });
  }
  candidates.sort((a, b) => compareReleaseIds(b.id, a.id));
  const best = candidates[0];
  if (best !== undefined) return best.dir;
  throw new Error(
    "No game data found. This installer was built without a data release, and none has been downloaded yet.",
  );
}

/** Ids of everything usable right now: downloaded releases plus the bundled one. */
export async function knownReleaseIds(dirs: AppDirs): Promise<string[]> {
  const ids = await installedReleaseIds(dirs.downloadedReleasesDir);
  if (await isRelease(dirs.bundledReleaseDir)) {
    ids.push(await manifestId(dirs.bundledReleaseDir));
  }
  return ids;
}
