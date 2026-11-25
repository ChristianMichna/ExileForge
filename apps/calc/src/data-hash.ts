import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { CalcServiceError } from "./errors.ts";

/** PoB src/ subdirectories that hold game data (not calculation code). */
export const DATA_DIRS = ["Data", "TreeData"] as const;
/** Only data files count; TreeData also holds hundreds of MB of images. */
const DATA_FILE = /\.(lua|json)$/i;

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const e of entries) {
    if (e.isFile() && DATA_FILE.test(e.name)) {
      out.push(join(e.parentPath, e.name));
    }
  }
  return out;
}

/**
 * SHA-256 over the game data the pinned PoB loads: every .lua/.json file in
 * src/Data and src/TreeData, as sorted `path NUL sha256(content)` lines.
 * Part of every cache key (meta.version `dataHash`).
 */
export async function computeDataHash(srcDir: string): Promise<string> {
  const files: string[] = [];
  for (const sub of DATA_DIRS) {
    try {
      files.push(...(await listFiles(join(srcDir, sub))));
    } catch (cause) {
      throw new CalcServiceError(
        "worker_crashed",
        "Path of Building data directory missing",
        join(srcDir, sub),
        { cause },
      );
    }
  }
  const rows = await Promise.all(
    files.map(async (file) => {
      const rel = relative(srcDir, file).split(sep).join("/");
      const digest = createHash("sha256")
        .update(await readFile(file))
        .digest("hex");
      return `${rel}\0${digest}\n`;
    }),
  );
  rows.sort();
  const total = createHash("sha256");
  for (const row of rows) total.update(row);
  return total.digest("hex");
}
