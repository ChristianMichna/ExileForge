import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diffSnapshots, summarizeDiff } from "../src/diff/snapshot-diff.ts";
import type { Json } from "../src/json.ts";
import {
  readShard,
  releaseId,
  sha256,
  writeManifest,
  type SnapshotManifest,
} from "../src/snapshot/snapshot.ts";

const HASH = "0".repeat(64);

async function fakeSnapshot(
  id: string,
  kinds: Record<string, Record<string, Json>>,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ef-snap-"));
  await mkdir(join(dir, "raw"));
  const shards: SnapshotManifest["shards"] = [];
  for (const [kind, entities] of Object.entries(kinds)) {
    const text = JSON.stringify({ kind, entities });
    await writeFile(join(dir, "raw", `${kind}.json`), text);
    shards.push({
      kind,
      path: `raw/${kind}.json`,
      sha256: sha256(text),
      count: Object.keys(entities).length,
    });
  }
  await writeManifest(dir, {
    format: "astrolabe-raw-snapshot/1",
    releaseId: id,
    gameVersion: id.slice(5, id.indexOf("+")),
    pobVersion: "fake",
    treeVersion: "fake",
    createdAt: "2026-01-01T00:00:00.000Z",
    sourceHashes: { "pob-sources.json": HASH },
    shards,
  });
  return dir;
}

describe("releaseId", () => {
  it("builds poe2-<game>+r<n>", () => {
    expect(releaseId("1.0.0.3", 2)).toBe("poe2-1.0.0.3+r2");
  });
  it("rejects malformed versions", () => {
    expect(() => releaseId("1.0-beta", 1)).toThrow(/invalid release id/);
    expect(() => releaseId("1", 1)).toThrow(/invalid release id/);
  });
});

describe("snapshots", () => {
  it("diffs all kinds between two snapshots", async () => {
    const a = await fakeSnapshot("poe2-9.1+r1", {
      widgets: { W1: { v: 1 }, W2: { v: 1 } },
      gadgets: { G1: {} },
    });
    const b = await fakeSnapshot("poe2-9.2+r1", {
      widgets: { W1: { v: 2 }, W3: { v: 1 } },
      gadgets: { G1: {} },
    });
    const diff = await diffSnapshots(a, b);
    expect(diff).toEqual({
      from: "poe2-9.1+r1",
      to: "poe2-9.2+r1",
      kinds: {
        gadgets: { added: [], removed: [], changed: [] },
        widgets: {
          added: ["W3"],
          removed: ["W2"],
          changed: [{ id: "W1", fields: [{ path: "/v", before: 1, after: 2 }] }],
        },
      },
    });
    expect(summarizeDiff(diff)).toContain("| widgets | 1 | 1 | 1 |");
  });

  it("refuses to diff snapshots with different kinds", async () => {
    const a = await fakeSnapshot("poe2-9.1+r1", { widgets: { W1: {} } });
    const b = await fakeSnapshot("poe2-9.2+r1", { gadgets: { G1: {} } });
    await expect(diffSnapshots(a, b)).rejects.toThrow(/different kinds/);
  });

  it("refuses to diff a release against itself", async () => {
    const a = await fakeSnapshot("poe2-9.1+r1", { widgets: { W1: {} } });
    const b = await fakeSnapshot("poe2-9.1+r1", { widgets: { W1: {} } });
    await expect(diffSnapshots(a, b)).rejects.toThrow(/two different releases/);
  });

  it("detects a shard that does not match its manifest hash", async () => {
    const dir = await fakeSnapshot("poe2-9.1+r1", { widgets: { W1: {} } });
    await writeFile(
      join(dir, "raw", "widgets.json"),
      JSON.stringify({ kind: "widgets", entities: { W1: { tampered: true } } }),
    );
    const b = await fakeSnapshot("poe2-9.2+r1", { widgets: { W1: {} } });
    await expect(diffSnapshots(dir, b)).rejects.toThrow(/does not match its manifest hash/);
  });

  it("fails on a missing manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ef-empty-"));
    await expect(readShard(dir, {} as SnapshotManifest, "x")).rejects.toThrow();
    await expect(diffSnapshots(dir, dir)).rejects.toThrow(/cannot read snapshot manifest/);
  });
});
