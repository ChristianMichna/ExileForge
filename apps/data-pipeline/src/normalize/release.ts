import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  CATALOG_SCHEMA_VERSION,
  CatalogManifest,
  CatalogShard,
} from "@exileforge/contracts/catalog";
import type { Json } from "../json.ts";
import { readManifest, readShard, sha256 } from "../snapshot/snapshot.ts";
import {
  normalizeCatalog,
  type CatalogEntities,
  type Finding,
  type NormalizeConfig,
} from "./catalog.ts";
import { StatMatcher } from "./stat-matcher.ts";
import { validateCatalog } from "./validate.ts";

/** Raw kinds the normalisation reads from a snapshot. */
const RAW_KINDS = [
  "itemBases",
  "mods",
  "uniques",
  "gems",
  "gemLevels",
  "passiveTree",
  "statDescriptions",
] as const;

export interface CatalogBuildResult {
  manifest: CatalogManifest;
  /** non-blocking: data PoB does not provide, dropped dangling references … */
  warnings: Finding[];
}

/**
 * Builds the catalog files of a data release from a raw snapshot:
 * `<out>/<kind>.json` (CatalogShard), `<out>/manifest.json` (CatalogManifest)
 * and `<out>/findings.json`. Any contract violation or broken reference
 * aborts before a manifest is written.
 */
export async function buildCatalog(
  snapshotDir: string,
  outDir: string,
  cfg: NormalizeConfig,
  cfgPath: string,
  now: Date = new Date(),
): Promise<CatalogBuildResult> {
  const snap = await readManifest(snapshotDir);
  const raw: Record<string, Record<string, Json>> = {};
  for (const kind of RAW_KINDS) raw[kind] = await readShard(snapshotDir, snap, kind);
  const matcher = new StatMatcher(raw.statDescriptions ?? {});
  const { entities, findings } = normalizeCatalog(raw, { mod: matcher, passiveNode: matcher }, cfg);
  const { entities: valid, errors } = validateCatalog(entities);

  const out = resolve(outDir);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, "findings.json"),
    JSON.stringify({ errors, warnings: findings }, null, 2) + "\n",
  );
  if (errors.length > 0) {
    const sample = errors
      .slice(0, 10)
      .map((e) => `  ${e.kind} ${e.id}: ${e.message}`)
      .join("\n");
    throw new Error(
      `catalog for ${snap.releaseId} has ${String(errors.length)} errors (see findings.json):\n${sample}`,
    );
  }

  const shards: CatalogManifest["shards"] = [];
  for (const kind of Object.keys(valid) as (keyof CatalogEntities)[]) {
    const shard = CatalogShard.parse({
      schemaVersion: CATALOG_SCHEMA_VERSION,
      dataReleaseId: snap.releaseId,
      kind,
      entities: valid[kind],
    });
    const text = JSON.stringify(shard) + "\n";
    const path = `${kind}.json`;
    await writeFile(join(out, path), text);
    shards.push({ kind, path, sha256: sha256(text), count: shard.entities.length });
  }

  const sourceHashes: Record<string, string> = { ...snap.sourceHashes };
  for (const s of snap.shards) sourceHashes[`raw/${s.kind}`] = s.sha256;
  sourceHashes["normalize.json"] = sha256(await readFile(cfgPath));

  const manifest = CatalogManifest.parse({
    schemaVersion: CATALOG_SCHEMA_VERSION,
    release: {
      id: snap.releaseId,
      gameVersion: snap.gameVersion,
      pobVersion: snap.pobVersion,
      pipelineRevision: Number(/\+r(\d+)$/.exec(snap.releaseId)?.[1]),
      sourceHashes,
      createdAt: now.toISOString(),
    },
    shards,
  });
  await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { manifest, warnings: findings };
}
