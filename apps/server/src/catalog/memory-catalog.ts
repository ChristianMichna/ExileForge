import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CatalogManifest, CatalogShard, type DataRelease } from "@astrolabe/contracts/catalog";
import type { DataReleaseId, EntityKind, EntityRef } from "@astrolabe/contracts/common";
import type { CatalogEntry, CatalogPort, CatalogQuery } from "../ports/catalog.js";

/** In-memory catalog built from validated shards of one data release. */
export class MemoryCatalog implements CatalogPort {
  private readonly byKind = new Map<EntityKind, Map<string, CatalogEntry>>();
  private readonly stats = new Set<string>();

  constructor(
    readonly dataReleaseId: DataReleaseId,
    shards: readonly CatalogShard[],
    readonly release?: DataRelease | undefined,
  ) {
    for (const shard of shards) {
      if (shard.dataReleaseId !== dataReleaseId) {
        throw new Error(
          `Shard ${shard.kind} belongs to ${shard.dataReleaseId}, expected ${dataReleaseId}`,
        );
      }
      const entries = this.byKind.get(shard.kind) ?? new Map<string, CatalogEntry>();
      for (const entity of shard.entities) {
        const name = "name" in entity && typeof entity.name === "string" ? entity.name : undefined;
        for (const statId of statIdsOf(entity)) this.stats.add(statId);
        entries.set(entity.id, {
          kind: shard.kind,
          id: entity.id,
          ...(name === undefined ? {} : { name }),
          entity,
        });
      }
      this.byKind.set(shard.kind, entries);
    }
  }

  get(ref: EntityRef): CatalogEntry | undefined {
    return this.byKind.get(ref.kind)?.get(ref.id);
  }

  list(kind: EntityKind): CatalogEntry[] {
    return [...(this.byKind.get(kind)?.values() ?? [])];
  }

  hasStat(statId: string): boolean {
    return this.stats.has(statId);
  }

  search(query: CatalogQuery): CatalogEntry[] {
    const needle = (query.text ?? "").toLowerCase();
    const kinds = query.kind === undefined ? [...this.byKind.keys()] : [query.kind];
    const hits: CatalogEntry[] = [];
    for (const kind of kinds) {
      for (const entry of this.byKind.get(kind)?.values() ?? []) {
        if (hits.length >= query.limit) return hits;
        if (needle !== "" && !`${entry.name ?? ""}\n${entry.id}`.toLowerCase().includes(needle)) {
          continue;
        }
        if (query.tags !== undefined && query.tags.length > 0) {
          const tags = (entry.entity as { tags?: unknown }).tags;
          if (!Array.isArray(tags) || !query.tags.every((t) => tags.includes(t))) continue;
        }
        hits.push(entry);
      }
    }
    return hits;
  }
}

/** Stat ids an entity uses: mod/node/unique stat lists, gem level stats and quality stats. */
function statIdsOf(entity: unknown): string[] {
  const out: string[] = [];
  const e = entity as {
    stats?: unknown;
    mods?: { stats?: { statId?: string }[] }[];
    levels?: { stats?: Record<string, unknown> }[];
    qualityStats?: { statId?: string }[];
  };
  if (Array.isArray(e.stats)) {
    for (const s of e.stats as { statId?: string }[])
      if (typeof s.statId === "string") out.push(s.statId);
  }
  for (const line of e.mods ?? []) {
    for (const s of line.stats ?? []) if (typeof s.statId === "string") out.push(s.statId);
  }
  for (const level of e.levels ?? []) out.push(...Object.keys(level.stats ?? {}));
  for (const s of e.qualityStats ?? []) if (typeof s.statId === "string") out.push(s.statId);
  return out;
}

/**
 * Loads a data release directory (manifest.json + shards), verifies every
 * shard hash and schema. Any mismatch is an error: no partial catalog.
 */
export async function loadCatalogRelease(dir: string): Promise<MemoryCatalog> {
  const manifest = parseJson(
    CatalogManifest,
    await readFile(join(dir, "manifest.json"), "utf8"),
    "manifest.json",
  );
  const shards: CatalogShard[] = [];
  for (const entry of manifest.shards) {
    const raw = await readFile(join(dir, entry.path));
    const hash = createHash("sha256").update(raw).digest("hex");
    if (hash !== entry.sha256) {
      throw new Error(
        `Shard ${entry.path}: sha256 mismatch (manifest ${entry.sha256}, file ${hash})`,
      );
    }
    const shard = parseJson(CatalogShard, raw.toString("utf8"), entry.path);
    if (shard.kind !== entry.kind) {
      throw new Error(`Shard ${entry.path}: kind ${shard.kind}, manifest says ${entry.kind}`);
    }
    shards.push(shard);
  }
  return new MemoryCatalog(manifest.release.id, shards, manifest.release);
}

function parseJson<T extends z.ZodType>(schema: T, text: string, what: string): z.infer<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${what} is not valid JSON`, { cause: error });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${what} does not match the contract: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
