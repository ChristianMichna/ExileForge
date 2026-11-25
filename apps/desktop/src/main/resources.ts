import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface AppDirs {
  /** Holds web/, config/, exileforge.mcpb and data-release/ (packaged) or the repository (dev). */
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
}

/**
 * Folder layout. Packaged: everything sits in `process.resourcesPath` (see
 * electron-builder.yml extraResources). Development: the repository.
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
      ? join(root, "exileforge.mcpb")
      : join(root, "apps", "mcp-bridge", "dist", "exileforge.mcpb"),
    downloadedReleasesDir: join(opts.userData, "data-releases"),
    bundledReleaseDir: opts.packaged
      ? join(root, "data-release")
      : join(root, "data-snapshots", "current", "catalog"),
    databasePath: join(opts.userData, "exileforge.sqlite"),
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

/**
 * Picks the data release to load: an explicit override, then the newest
 * downloaded release, then the one bundled with the installer. Throws with a
 * plain explanation when there is none; there is no empty fallback catalog.
 */
export async function findDataRelease(dirs: AppDirs, override?: string): Promise<string> {
  if (override !== undefined && override !== "") {
    if (await isRelease(override)) return override;
    throw new Error(`EXILEFORGE_DATA_RELEASE points to ${override}, which has no manifest.json.`);
  }
  let names: string[] = [];
  try {
    names = await readdir(dirs.downloadedReleasesDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Cannot read ${dirs.downloadedReleasesDir}`, { cause: error });
    }
  }
  // Release ids sort by game version and revision as text only within one game version; the
  // newest download is the one with the latest modification time instead.
  const candidates: { dir: string; mtimeMs: number }[] = [];
  for (const name of names) {
    const dir = join(dirs.downloadedReleasesDir, name);
    if (await isRelease(dir)) candidates.push({ dir, mtimeMs: (await stat(dir)).mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const newest = candidates[0];
  if (newest !== undefined) return newest.dir;
  if (await isRelease(dirs.bundledReleaseDir)) return dirs.bundledReleaseDir;
  throw new Error(
    "No game data found. This installer was built without a data release, and none has been downloaded yet.",
  );
}
