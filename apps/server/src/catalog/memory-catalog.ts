import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CatalogManifest, CatalogShard } from "@exileforge/contracts/catalog";
import type { DataReleaseId, EntityKind, EntityRef } from "@exileforge/contracts/common";
import type { CatalogEntry, CatalogPort } from "../ports/catalog.js";

/** In-memory catalog built from validated shards of one data release. */
export class MemoryCatalog implements CatalogPort {
  private readonly byKind = new Map<EntityKind, Map<string, CatalogEntry>>();

  constructor(
    readonly dataReleaseId: DataReleaseId,
    shards: readonly CatalogShard[],
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

  search(query: { kind?: EntityKind; text: string; limit: number }): CatalogEntry[] {
    const needle = query.text.toLowerCase();
    const kinds = query.kind === undefined ? [...this.byKind.keys()] : [query.kind];
    const hits: CatalogEntry[] = [];
    for (const kind of kinds) {
      for (const entry of this.byKind.get(kind)?.values() ?? []) {
        if (hits.length >= query.limit) return hits;
        const hay = `${entry.name ?? ""}\n${entry.id}`.toLowerCase();
        if (hay.includes(needle)) hits.push(entry);
      }
    }
    return hits;
  }
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
  return new MemoryCatalog(manifest.release.id, shards);
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
