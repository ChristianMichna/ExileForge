import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import {
  CatalogDiff,
  CatalogManifest,
  GuideDocument,
  type DataRelease,
  type PatchStatus,
} from "@astrolabe/contracts";
import { RevalidationError, revalidateGuide } from "@astrolabe/revalidate";

export interface ReleaseForRevalidation {
  release: DataRelease;
  /** The diff against `release.previousReleaseId`; absent for a release without predecessor. */
  diff?: CatalogDiff;
}

async function readParsed<T extends z.ZodType>(
  schema: T,
  path: string,
  what: string,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (cause) {
    throw new RevalidationError(`Cannot read ${what} ${path}`, { cause });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new RevalidationError(
      `${what} ${path} does not match the contract: ${z.prettifyError(parsed.error)}`,
    );
  return parsed.data;
}

/** Reads a data release directory's manifest and, if it has one, its diff against the previous release. */
export async function loadReleaseForRevalidation(
  dir: string,
  options: { withDiff?: boolean } = {},
): Promise<ReleaseForRevalidation> {
  const { release } = await readParsed(CatalogManifest, join(dir, "manifest.json"), "manifest");
  if (release.diffPath === undefined || options.withDiff === false) return { release };
  const diffPath = resolve(dir, release.diffPath);
  const inside = relative(resolve(dir), diffPath);
  // the contract already forbids this; a second check, because the path comes from a downloaded file
  if (inside.startsWith("..") || inside === "")
    throw new RevalidationError(`The diff path of ${release.id} leaves the release directory`);
  const diff = await readParsed(CatalogDiff, diffPath, "diff");
  if (diff.from !== release.previousReleaseId || diff.to !== release.id)
    throw new RevalidationError(
      `The diff of ${release.id} goes from ${diff.from} to ${diff.to}, expected ${String(release.previousReleaseId)} to ${release.id}`,
    );
  return { release, diff };
}

/**
 * F-19: checks a stored guide against newer data releases. `releaseDirs` lists the guide's own
 * release first and the checked release last; every later release must carry the diff against
 * the one before it. A missing diff is an error, never "unaffected".
 */
export async function revalidateStoredGuide(input: {
  guide: unknown;
  releaseDirs: readonly string[];
  now: () => Date;
}): Promise<PatchStatus> {
  const parsed = GuideDocument.safeParse(input.guide);
  if (!parsed.success)
    throw new RevalidationError(
      `The guide does not match the contract: ${z.prettifyError(parsed.error)}`,
    );
  // the guide's own release needs no diff: only its manifest is read
  const loaded = await Promise.all(
    input.releaseDirs.map((dir, i) => loadReleaseForRevalidation(dir, { withDiff: i > 0 })),
  );
  const first = loaded[0];
  const last = loaded[loaded.length - 1];
  if (!first || !last || loaded.length < 2)
    throw new RevalidationError("Give at least the guide's release and a newer one");
  const diffs = loaded.slice(1).map((r) => {
    if (!r.diff)
      throw new RevalidationError(`Release ${r.release.id} has no diff against its predecessor`);
    return r.diff;
  });
  return revalidateGuide({
    guide: parsed.data,
    diffs,
    facts: { from: first.release, to: last.release },
    checkedAt: input.now().toISOString(),
  });
}
