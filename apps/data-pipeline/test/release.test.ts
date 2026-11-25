import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CatalogShard } from "@exileforge/contracts/catalog";
import { describe, expect, it } from "vitest";
import { buildCatalog, pipelineRevisionOf } from "../src/normalize/release.ts";
import { sha256, writeManifest } from "../src/snapshot/snapshot.ts";
import { cfg, rawSnapshot, type RawFixture } from "./fixtures/raw-catalog.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const config = { config: cfg, sha256: "c".repeat(64) };

async function writeSnapshot(raw: RawFixture, releaseId = "poe2-0.1+r2"): Promise<string> {
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
    format: "exileforge-raw-snapshot/1",
    releaseId,
    gameVersion: "0.1",
    pobVersion: "0.0.1",
    treeVersion: "0_1",
    createdAt: NOW.toISOString(),
    sourceHashes: { "pob-sources.json": "a".repeat(64) },
    shards,
  });
  return dir;
}

describe("buildCatalog", () => {
  it("writes shards, manifest and findings with matching hashes", async () => {
    const snap = await writeSnapshot(rawSnapshot());
    const out = join(await mkdtemp(join(tmpdir(), "ef-cat-")), "catalog");
    const { manifest, summary } = await buildCatalog(snap, out, config, NOW);

    expect(manifest.release).toMatchObject({
      id: "poe2-0.1+r2",
      pipelineRevision: 2,
      createdAt: NOW.toISOString(),
    });
    expect(manifest.release.sourceHashes["normalize.json"]).toBe(config.sha256);
    expect(manifest.release.sourceHashes["raw/mods"]).toMatch(/^[0-9a-f]{64}$/);
    for (const s of manifest.shards) {
      const text = await readFile(join(out, s.path), "utf8");
      expect(sha256(text)).toBe(s.sha256);
      expect(CatalogShard.parse(JSON.parse(text)).entities).toHaveLength(s.count);
    }
    const findings = JSON.parse(await readFile(join(out, "findings.json"), "utf8")) as {
      errors: unknown[];
      summary: unknown;
    };
    expect(findings.errors).toEqual([]);
    expect(findings.summary).toEqual(summary);
  });

  it("writes findings but no catalog when there are errors", async () => {
    const raw = rawSnapshot();
    delete raw.mods.AlphaHigh?.level;
    const snap = await writeSnapshot(raw);
    const out = join(await mkdtemp(join(tmpdir(), "ef-cat-")), "catalog");
    await expect(buildCatalog(snap, out, config, NOW)).rejects.toThrow(
      /errors[\s\S]*mod AlphaHigh: source has no level/,
    );
    expect(existsSync(join(out, "findings.json"))).toBe(true);
    expect(existsSync(join(out, "manifest.json"))).toBe(false);
    expect(existsSync(join(out, "mod.json"))).toBe(false);
  });

  it("refuses an output directory that would delete the snapshot or foreign files", async () => {
    const snap = await writeSnapshot(rawSnapshot());
    await expect(buildCatalog(snap, snap, config, NOW)).rejects.toThrow(
      /would delete the snapshot/,
    );
    await expect(buildCatalog(snap, join(snap, ".."), config, NOW)).rejects.toThrow(
      /would delete the snapshot/,
    );
    await expect(buildCatalog(snap, process.cwd(), config, NOW)).rejects.toThrow(
      /would delete the working directory/,
    );
    const foreign = await mkdtemp(join(tmpdir(), "ef-foreign-"));
    await writeFile(join(foreign, "keep.txt"), "x");
    await expect(buildCatalog(snap, foreign, config, NOW)).rejects.toThrow(/not an earlier output/);
    expect(existsSync(join(foreign, "keep.txt"))).toBe(true);
  });

  it("replaces a previous catalog output", async () => {
    const snap = await writeSnapshot(rawSnapshot());
    const out = join(await mkdtemp(join(tmpdir(), "ef-cat-")), "catalog");
    await buildCatalog(snap, out, config, NOW);
    await writeFile(join(out, "stale.json"), "{}");
    await buildCatalog(snap, out, config, NOW);
    expect(existsSync(join(out, "stale.json"))).toBe(false);
  });
});

describe("pipelineRevisionOf", () => {
  it("reads the revision and rejects ids without one", () => {
    expect(pipelineRevisionOf("poe2-0.1+r7")).toBe(7);
    expect(() => pipelineRevisionOf("poe2-0.1")).toThrow(/\+r<revision>/);
  });
});
