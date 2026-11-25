import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CatalogDiff, CatalogManifest } from "@astrolabe/contracts/catalog";
import { describe, expect, it } from "vitest";
import { diffCatalogs, writeCatalogDiff } from "../src/diff/catalog-diff.ts";
import { buildCatalog } from "../src/normalize/release.ts";
import { cfg, rawSnapshot } from "./fixtures/raw-catalog.ts";
import { SNAPSHOT_TIME, writeSnapshot } from "./fixtures/write-snapshot.ts";

const config = { config: cfg, sha256: "c".repeat(64) };

async function catalog(releaseId: string, edit?: (raw: ReturnType<typeof rawSnapshot>) => void) {
  const raw = rawSnapshot();
  edit?.(raw);
  const snap = await writeSnapshot(raw, releaseId);
  const out = join(await mkdtemp(join(tmpdir(), "ef-cd-")), "catalog");
  await buildCatalog(snap, out, config, SNAPSHOT_TIME);
  return out;
}

describe("catalog diff", () => {
  it("reports added, removed and changed entities between two releases", async () => {
    const from = await catalog("poe2-0.1+r1");
    const to = await catalog("poe2-0.1+r2", (raw) => {
      const mods = raw["mods"] as Record<string, Record<string, unknown>>;
      delete mods["AlphaHigh"];
      mods["AlphaLow"] = { ...mods["AlphaLow"], level: 5 };
    });
    const diff = await diffCatalogs(from, to);
    expect(CatalogDiff.parse(diff)).toBeTruthy();
    expect(diff.from).toBe("poe2-0.1+r1");
    expect(diff.to).toBe("poe2-0.1+r2");
    expect(diff.kinds["mod"]?.removed).toEqual(["AlphaHigh"]);
    expect(diff.kinds["mod"]?.changed.map((c) => c.id)).toEqual(["AlphaLow"]);
    expect(diff.kinds["mod"]?.changed[0]?.fields).toContainEqual(
      expect.objectContaining({ path: "/requiredLevel", after: 5 }),
    );
    expect(diff.kinds["baseItem"]).toEqual({ added: [], removed: [], changed: [] });
  });

  it("writes diff.json and links it from the newer manifest", async () => {
    const from = await catalog("poe2-0.1+r1");
    const to = await catalog("poe2-0.1+r2");
    await writeCatalogDiff(from, to);
    const manifest = CatalogManifest.parse(
      JSON.parse(await readFile(join(to, "manifest.json"), "utf8")),
    );
    expect(manifest.release).toMatchObject({
      previousReleaseId: "poe2-0.1+r1",
      diffPath: "diff.json",
    });
    CatalogDiff.parse(JSON.parse(await readFile(join(to, "diff.json"), "utf8")));
    // the shard hashes stay valid, so the catalog can still be diffed
    await expect(diffCatalogs(from, to)).resolves.toBeTruthy();
  });

  it("refuses to diff a release with itself", async () => {
    const a = await catalog("poe2-0.1+r1");
    const b = await catalog("poe2-0.1+r1");
    await expect(diffCatalogs(a, b)).rejects.toThrow(/must differ/);
  });

  it("fails on a shard that does not match its hash", async () => {
    const a = await catalog("poe2-0.1+r1");
    const b = await catalog("poe2-0.1+r2");
    await writeFile(join(b, "mod.json"), "{}");
    await expect(diffCatalogs(a, b)).rejects.toThrow(/manifest hash/);
  });

  it("fails when the catalogs have different kinds", async () => {
    const a = await catalog("poe2-0.1+r1");
    const b = await catalog("poe2-0.1+r2");
    const path = join(b, "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as { shards: { kind: string }[] };
    manifest.shards = manifest.shards.filter((s) => s.kind !== "craftingAction");
    await writeFile(path, JSON.stringify(manifest));
    await expect(diffCatalogs(a, b)).rejects.toThrow(/different kinds/);
  });
});
