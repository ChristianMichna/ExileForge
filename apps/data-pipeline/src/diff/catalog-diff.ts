import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CATALOG_SCHEMA_VERSION,
  CatalogDiff,
  CatalogManifest,
  CatalogShard,
} from "@astrolabe/contracts/catalog";
import type { Json } from "../json.ts";
import { sha256 } from "../snapshot/snapshot.ts";
import { diffEntities, type EntityMap } from "./diff.ts";

/** File name of the diff inside a data release (referenced by `diffPath`). */
export const CATALOG_DIFF_FILE = "diff.json";

interface LoadedCatalog {
  manifest: CatalogManifest;
  kinds: Map<string, EntityMap>;
}

async function readCatalog(dir: string): Promise<LoadedCatalog> {
  let manifest: CatalogManifest;
  try {
    manifest = CatalogManifest.parse(
      JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")),
    );
  } catch (cause) {
    throw new Error(`cannot read catalog manifest in ${dir}`, { cause });
  }
  const kinds = new Map<string, EntityMap>();
  for (const s of manifest.shards) {
    const path = join(dir, s.path);
    const text = await readFile(path, "utf8").catch((cause: unknown) => {
      throw new Error(`cannot read catalog shard ${path}`, { cause });
    });
    if (sha256(text) !== s.sha256)
      throw new Error(`catalog shard ${path} does not match its manifest hash`);
    const shard = CatalogShard.parse(JSON.parse(text));
    const byId: Record<string, Json> = {};
    for (const e of shard.entities) {
      const id = (e as { id: string }).id;
      if (Object.hasOwn(byId, id)) throw new Error(`catalog shard ${path} repeats id ${id}`);
      byId[id] = e as unknown as Json;
    }
    kinds.set(s.kind, byId);
  }
  return { manifest, kinds };
}

/**
 * Diff between two built catalogs (data releases). Both must have the same
 * schema version and the same kinds; a kind on one side only means the
 * pipeline changed and would otherwise read as "everything added/removed".
 */
export async function diffCatalogs(fromDir: string, toDir: string): Promise<CatalogDiff> {
  const [from, to] = await Promise.all([readCatalog(fromDir), readCatalog(toDir)]);
  const [fromId, toId] = [from.manifest.release.id, to.manifest.release.id];
  if (from.manifest.schemaVersion !== to.manifest.schemaVersion)
    throw new Error(`catalogs ${fromId} and ${toId} have different schema versions`);
  const fromKinds = [...from.kinds.keys()].sort();
  const toKinds = [...to.kinds.keys()].sort();
  if (fromKinds.join() !== toKinds.join())
    throw new Error(
      `catalogs have different kinds: ${fromId} has ${fromKinds.join(", ")}; ${toId} has ${toKinds.join(", ")}`,
    );
  const kinds: Record<string, ReturnType<typeof diffEntities>> = {};
  for (const kind of fromKinds)
    kinds[kind] = diffEntities(from.kinds.get(kind) ?? {}, to.kinds.get(kind) ?? {});
  return CatalogDiff.parse({
    schemaVersion: CATALOG_SCHEMA_VERSION,
    from: fromId,
    to: toId,
    kinds,
  });
}

/**
 * Writes `diff.json` into the newer catalog and records it in that catalog's
 * manifest (`previousReleaseId`, `diffPath`). Shard files and their hashes are
 * untouched.
 */
export async function writeCatalogDiff(fromDir: string, toDir: string): Promise<CatalogDiff> {
  const diff = await diffCatalogs(fromDir, toDir);
  const manifestPath = join(toDir, "manifest.json");
  const manifest = CatalogManifest.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const updated = CatalogManifest.parse({
    ...manifest,
    release: { ...manifest.release, previousReleaseId: diff.from, diffPath: CATALOG_DIFF_FILE },
  });
  await writeFile(join(toDir, CATALOG_DIFF_FILE), JSON.stringify(diff, null, 2) + "\n");
  await writeFile(manifestPath, JSON.stringify(updated, null, 2) + "\n");
  return diff;
}

/** Short human summary (counts per kind). */
export function summarizeCatalogDiff(diff: CatalogDiff): string {
  const lines = [
    `Catalog diff ${diff.from} -> ${diff.to}`,
    "",
    "| Kind | added | removed | changed |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const [kind, d] of Object.entries(diff.kinds))
    lines.push(
      `| ${kind} | ${String(d.added.length)} | ${String(d.removed.length)} | ${String(d.changed.length)} |`,
    );
  return lines.join("\n") + "\n";
}
