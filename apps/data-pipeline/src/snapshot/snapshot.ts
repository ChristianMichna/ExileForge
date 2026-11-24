import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Json } from "../json.ts";

/**
 * A raw snapshot is the extractor output of one PoB version for one game
 * version: raw/<kind>.json shards plus manifest.json with hashes. It is the
 * input for normalisation to the catalog contract and for diffs between
 * versions. Release ids follow `poe2-<gameVersion>+r<revision>`.
 */
export const releaseIdPattern = /^poe2-\d+(?:\.\d+){1,3}\+r\d+$/;

export const snapshotManifestSchema = z
  .object({
    format: z.literal("exileforge-raw-snapshot/1"),
    releaseId: z.string().regex(releaseIdPattern),
    gameVersion: z.string().regex(/^\d+(?:\.\d+){1,3}$/),
    pobVersion: z.string().min(1),
    treeVersion: z.string().min(1),
    createdAt: z.iso.datetime(),
    /** sha256 of the source config and of the extractor script */
    sourceHashes: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)),
    shards: z
      .array(
        z
          .object({
            kind: z.string().min(1),
            path: z.string().min(1),
            sha256: z.string().regex(/^[0-9a-f]{64}$/),
            count: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type SnapshotManifest = z.infer<typeof snapshotManifestSchema>;

const shardFileSchema = z
  .object({ kind: z.string(), entities: z.record(z.string(), z.json()) })
  .strict();

export function releaseId(gameVersion: string, revision: number): string {
  const id = `poe2-${gameVersion}+r${String(revision)}`;
  if (!releaseIdPattern.test(id)) {
    throw new Error(`invalid release id ${id} (game version like 0.5 or 1.0.0.3, revision >= 0)`);
  }
  return id;
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function readManifest(dir: string): Promise<SnapshotManifest> {
  const path = join(dir, "manifest.json");
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (cause) {
    throw new Error(`cannot read snapshot manifest ${path}`, { cause });
  }
  const parsed = snapshotManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`invalid snapshot manifest ${path}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export async function writeManifest(dir: string, manifest: SnapshotManifest): Promise<void> {
  await writeFile(
    join(dir, "manifest.json"),
    JSON.stringify(snapshotManifestSchema.parse(manifest), null, 2) + "\n",
  );
}

/** Reads one shard and verifies its hash and entity count against the manifest. */
export async function readShard(
  dir: string,
  manifest: SnapshotManifest,
  kind: string,
): Promise<Record<string, Json>> {
  const shard = manifest.shards.find((s) => s.kind === kind);
  if (!shard) throw new Error(`snapshot ${manifest.releaseId} has no kind ${kind}`);
  const path = join(dir, shard.path);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (cause) {
    throw new Error(`cannot read shard ${path}`, { cause });
  }
  if (sha256(bytes) !== shard.sha256) {
    throw new Error(`shard ${path} does not match its manifest hash`);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new Error(`shard ${path} is not valid UTF-8`, { cause });
  }
  const parsed = shardFileSchema.parse(JSON.parse(text));
  if (parsed.kind !== kind)
    throw new Error(`shard ${path} holds kind ${parsed.kind}, expected ${kind}`);
  const count = Object.keys(parsed.entities).length;
  if (count !== shard.count) {
    throw new Error(
      `shard ${path} has ${String(count)} entities, manifest says ${String(shard.count)}`,
    );
  }
  return parsed.entities;
}
