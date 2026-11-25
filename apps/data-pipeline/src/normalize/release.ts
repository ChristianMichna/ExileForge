import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  CATALOG_SCHEMA_VERSION,
  CatalogManifest,
  CatalogShard,
} from "@exileforge/contracts/catalog";
import { z } from "zod";
import type { Json } from "../json.ts";
import { prepareOutDir } from "../out-dir.ts";
import { readManifest, readShard, sha256 } from "../snapshot/snapshot.ts";
import {
  normalizeCatalog,
  type CatalogEntities,
  type Finding,
  type NormalizeConfig,
  type NormalizeSummary,
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
  "skills",
  "passiveTree",
  "statDescriptions",
] as const;

/** Written first, so a directory holding it is a previous catalog output. */
const FINDINGS_FILE = "findings.json";

export interface CatalogBuildResult {
  manifest: CatalogManifest;
  /** non-blocking: data PoB does not provide, dropped dangling references … */
  warnings: Finding[];
  summary: NormalizeSummary;
}

/** `<id>+r<n>` → n; the release id format is checked by the contract. */
export function pipelineRevisionOf(releaseId: string): number {
  const m = /\+r(\d+)$/.exec(releaseId);
  if (!m?.[1]) throw new Error(`release id ${releaseId} has no +r<revision> suffix`);
  return Number(m[1]);
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const res = schema.safeParse(value);
  if (!res.success)
    throw new Error(`${what} violates the contract: ${z.prettifyError(res.error)}`, {
      cause: res.error,
    });
  return res.data;
}

/**
 * Builds the catalog files of a data release from a raw snapshot:
 * `<out>/<kind>.json` (CatalogShard), `<out>/manifest.json` (CatalogManifest)
 * and `<out>/findings.json`. Any error (missing required source value,
 * contract violation, broken reference) aborts before a shard or manifest is
 * written; findings.json is written in every case.
 */
export async function buildCatalog(
  snapshotDir: string,
  outDir: string,
  cfg: { config: NormalizeConfig; sha256: string },
  now: Date = new Date(),
): Promise<CatalogBuildResult> {
  const snap = await readManifest(snapshotDir);
  const pipelineRevision = pipelineRevisionOf(snap.releaseId);
  const raw: Record<string, Record<string, Json>> = {};
  for (const kind of RAW_KINDS) raw[kind] = await readShard(snapshotDir, snap, kind);
  const matcher = new StatMatcher(raw.statDescriptions ?? {});
  const norm = normalizeCatalog(raw, { mod: matcher, passiveNode: matcher }, cfg.config);
  const validation = validateCatalog(norm.entities);
  const errors = [...norm.errors, ...validation.errors];

  const out = resolve(outDir);
  await prepareOutDir(
    out,
    [
      { what: "the snapshot", dir: snapshotDir },
      { what: "the working directory", dir: process.cwd() },
    ],
    FINDINGS_FILE,
  );
  await writeFile(
    join(out, FINDINGS_FILE),
    JSON.stringify(
      {
        releaseId: snap.releaseId,
        summary: norm.summary,
        errors,
        warnings: norm.warnings,
        unresolved: norm.unresolved,
        hiddenStatGroups: norm.hiddenStatGroups,
      },
      null,
      2,
    ) + "\n",
  );
  if (errors.length > 0) {
    const sample = errors
      .slice(0, 10)
      .map((e) => `  ${e.kind} ${e.id}: ${e.message}`)
      .join("\n");
    throw new Error(
      `catalog for ${snap.releaseId} has ${String(errors.length)} errors (see ${FINDINGS_FILE}):\n${sample}`,
    );
  }

  const shards: CatalogManifest["shards"] = [];
  for (const kind of Object.keys(validation.entities) as (keyof CatalogEntities)[]) {
    const shard = parseOrThrow(
      CatalogShard,
      {
        schemaVersion: CATALOG_SCHEMA_VERSION,
        dataReleaseId: snap.releaseId,
        kind,
        entities: validation.entities[kind],
      },
      `shard ${kind}`,
    );
    const text = JSON.stringify(shard) + "\n";
    const path = `${kind}.json`;
    await writeFile(join(out, path), text);
    shards.push({ kind, path, sha256: sha256(text), count: shard.entities.length });
  }

  const sourceHashes: Record<string, string> = { ...snap.sourceHashes };
  for (const s of snap.shards) sourceHashes[`raw/${s.kind}`] = s.sha256;
  sourceHashes["normalize.json"] = cfg.sha256;

  const manifest = parseOrThrow(
    CatalogManifest,
    {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      release: {
        id: snap.releaseId,
        gameVersion: snap.gameVersion,
        pobVersion: snap.pobVersion,
        pipelineRevision,
        sourceHashes,
        createdAt: now.toISOString(),
      },
      shards,
    },
    "catalog manifest",
  );
  await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { manifest, warnings: norm.warnings, summary: norm.summary };
}
