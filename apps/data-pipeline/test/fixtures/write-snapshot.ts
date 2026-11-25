import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256, writeManifest } from "../../src/snapshot/snapshot.ts";
import type { RawFixture } from "./raw-catalog.ts";

export const SNAPSHOT_TIME = new Date("2026-01-01T00:00:00.000Z");

export async function writeSnapshot(raw: RawFixture, releaseId = "poe2-0.1+r2"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ef-snap-"));
  await mkdir(join(dir, "raw"));
  const shards = [];
  for (const [kind, entities] of Object.entries(raw)) {
    const text = JSON.stringify({ kind, entities });
    const path = `raw/${kind}.json`;
    await writeFile(join(dir, path), text);
    shards.push({ kind, path, sha256: sha256(text), count: Object.keys(entities).length });
  }
  await writeManifest(dir, {
    format: "astrolabe-raw-snapshot/1",
    releaseId,
    gameVersion: "0.1",
    pobVersion: "0.0.1",
    treeVersion: "0_1",
    createdAt: SNAPSHOT_TIME.toISOString(),
    sourceHashes: { "pob-sources.json": "a".repeat(64) },
    shards,
  });
  return dir;
}
