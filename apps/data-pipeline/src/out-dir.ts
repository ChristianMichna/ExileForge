import { mkdir, readdir, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

function isSameOrInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Prepares an output directory that is replaced as a whole. Refuses a
 * directory that contains a protected one (the input, the working directory)
 * and a non-empty directory that is not an earlier output of the same kind
 * (recognised by its marker file).
 */
export async function prepareOutDir(
  out: string,
  protectedDirs: readonly { what: string; dir: string }[],
  marker: string,
): Promise<void> {
  const target = resolve(out);
  for (const { what, dir } of protectedDirs) {
    if (isSameOrInside(resolve(dir), target))
      throw new Error(`--out ${target} would delete ${what} (${resolve(dir)})`);
  }
  let existing: string[];
  try {
    existing = await readdir(target);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") existing = [];
    else throw new Error(`cannot read --out ${target}`, { cause });
  }
  if (existing.length > 0 && !existing.includes(marker))
    throw new Error(`--out ${target} is a non-empty directory that is not an earlier output`);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
}
