import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CatalogShard } from "@astrolabe/contracts/catalog";
import { describe, expect, it } from "vitest";
import { buildCatalog, pipelineRevisionOf } from "../src/normalize/release.ts";
import { sha256, writeManifest } from "../src/snapshot/snapshot.ts";
import { write, tables } from "./fixtures/game-data.ts";
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
    format: "astrolabe-raw-snapshot/1",
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

// invented game data: the currency tables plus a level table
async function writeGameData(levels: number[]): Promise<string> {
  return write({
    ...tables(),
    Levels: levels.map((Level) => ({ Level })),
  });
}

describe("essences without game data", () => {
  it("leaves actions out and says so", async () => {
    const snap = await writeSnapshot(rawSnapshot());
    const out = join(await mkdtemp(join(tmpdir(), "ef-cat-")), "catalog");
    const { warnings } = await buildCatalog(snap, out, config, NOW);
    expect(warnings.map((w) => w.message).join("\n")).toMatch(
      /essence crafting actions are left out/,
    );
  });
});

describe("currency without game data", () => {
  it("leaves currency out and says so", async () => {
    const snap = await writeSnapshot(rawSnapshot());
    const out = join(await mkdtemp(join(tmpdir(), "ef-cat-")), "catalog");
    const { warnings } = await buildCatalog(snap, out, config, NOW);
    expect(warnings.map((w) => w.message).join("\n")).toMatch(/currency items are left out/);
  });
});

describe("release facts", () => {
  const factsConfig = {
    ...config,
    config: { ...cfg, releaseFacts: { ...cfg.releaseFacts, maxLevelTable: "Levels" } },
  };

  it("reads the maximum level and the passive points with their origin", async () => {
    const snap = await writeSnapshot(rawSnapshot());
    const out = join(await mkdtemp(join(tmpdir(), "ef-cat-")), "catalog");
    const gameDataDir = await writeGameData([1, 2, 7, 5]);
    const { manifest } = await buildCatalog(snap, out, factsConfig, NOW, { gameDataDir });
    expect(manifest.release.maxCharacterLevel).toEqual({ value: 7, origin: "game-data" });
    const shard = CatalogShard.parse(
      JSON.parse(await readFile(join(out, "baseItem.json"), "utf8")),
    );
    expect(shard.entities.map((e) => (e as { id: string }).id)).toContain("Test/Orb");
    const actions = CatalogShard.parse(
      JSON.parse(await readFile(join(out, "craftingAction.json"), "utf8")),
    );
    expect(actions.entities).toEqual([
      expect.objectContaining({
        id: "Test/Essence",
        kind: "essence",
        itemId: "Test/Essence",
        effects: [{ op: "add-specific-mod", params: { modByItemClass: { Ring: "AlphaLow" } } }],
      }),
    ]);
    const findings = JSON.parse(await readFile(join(out, "findings.json"), "utf8")) as {
      warnings: { kind: string; message: string }[];
    };
    const text = findings.warnings
      .filter((w) => w.kind === "essence")
      .map((w) => w.message)
      .join("\n");
    expect(text).toMatch(/item class "Wand" is not in the catalog/);
    expect(text).toMatch(/mod "NoSuchMod" for Sword is not in the catalog/);
    expect(text).toMatch(/Other Essence: no currency base item/);
    expect(manifest.release.passivePoints).toEqual({
      mainTree: {
        perLevel: cfg.releaseFacts.mainTree.perLevel,
        fromLevel: cfg.releaseFacts.mainTree.fromLevel,
        origin: "pob-code",
      },
      weaponSetByAct: {
        acts: [
          { act: 1, areaLevel: 9, points: 3 },
          { act: 2, areaLevel: 12, points: 2 },
        ],
        origin: "pob-data",
      },
    });
  });

  it("leaves the maximum level out and says so when no game data is given", async () => {
    const snap = await writeSnapshot(rawSnapshot());
    const out = join(await mkdtemp(join(tmpdir(), "ef-cat-")), "catalog");
    const { manifest, warnings } = await buildCatalog(snap, out, factsConfig, NOW);
    expect(manifest.release.maxCharacterLevel).toBeUndefined();
    expect(warnings).toContainEqual(
      expect.objectContaining({ kind: "release", id: "maxCharacterLevel" }),
    );
  });

  it("fails when PoB marks quest rewards with a Type (its rule would need mirroring)", async () => {
    const raw = rawSnapshot();
    (raw.questRewards["0002"] as Record<string, unknown>).Type = "Cruel";
    const snap = await writeSnapshot(raw);
    const out = join(await mkdtemp(join(tmpdir(), "ef-cat-")), "catalog");
    await expect(buildCatalog(snap, out, factsConfig, NOW)).rejects.toThrow(/quest reward 0002/);
  });

  it("lists the slots in PoB's order with what PoB accepts", async () => {
    const snap = await writeSnapshot(rawSnapshot());
    const out = join(await mkdtemp(join(tmpdir(), "ef-cat-")), "catalog");
    const { manifest } = await buildCatalog(snap, out, factsConfig, NOW);
    expect(manifest.release.itemSlots).toEqual({
      origin: "pob-code",
      slots: [
        {
          id: "Fake Finger",
          order: 1,
          label: "Fake Finger",
          itemClasses: ["Ring"],
          optional: true,
        },
        {
          id: "Fake Hand 2",
          order: 2,
          label: "Fake Hand",
          weaponSet: 2,
          itemClasses: ["Sword"],
          dependsOnSlot: "Fake Finger",
        },
        {
          id: "Fake Charm",
          order: 3,
          label: "Fake Charm",
          itemClasses: [],
          partialBases: ["Odd Charm"],
        },
      ],
    });
  });

  it("is an error when a slot names a class, a base or a slot that does not exist", async () => {
    const raw = rawSnapshot();
    raw.itemSlots["Fake Finger"] = { order: 1, label: "F", itemClasses: ["Ghost Class"] };
    raw.itemSlots["Fake Charm"] = {
      order: 3,
      label: "C",
      itemClasses: [],
      partialBases: ["Ghost Base"],
    };
    raw.itemSlots["Fake Hand 2"] = {
      order: 2,
      label: "H",
      itemClasses: ["Sword"],
      dependsOnSlot: "Nowhere",
    };
    const snap = await writeSnapshot(raw);
    const out = join(await mkdtemp(join(tmpdir(), "ef-cat-")), "catalog");
    const failure = buildCatalog(snap, out, factsConfig, NOW);
    await expect(failure).rejects.toThrow(/itemSlot Fake Finger: item class Ghost Class/);
    await expect(failure).rejects.toThrow(
      /itemSlot Fake Charm: base Ghost Base is not in the catalog/,
    );
    await expect(failure).rejects.toThrow(/itemSlot Fake Hand 2: depends on slot Nowhere/);
  });

  it("warns about a catalog class that no slot accepts", async () => {
    const raw = rawSnapshot();
    delete raw.itemSlots["Fake Charm"];
    const snap = await writeSnapshot(raw);
    const out = join(await mkdtemp(join(tmpdir(), "ef-cat-")), "catalog");
    const { warnings } = await buildCatalog(snap, out, factsConfig, NOW);
    expect(warnings).toContainEqual({
      kind: "itemSlot",
      id: "Charm",
      message: "no equipment slot accepts item class Charm",
    });
  });

  it("fails on a level table that is not the configured one", async () => {
    const snap = await writeSnapshot(rawSnapshot());
    const out = join(await mkdtemp(join(tmpdir(), "ef-cat-")), "catalog");
    const gameDataDir = await writeGameData([1, 2]);
    const wrong = {
      ...config,
      config: { ...cfg, releaseFacts: { ...cfg.releaseFacts, maxLevelTable: "Nope" } },
    };
    await expect(buildCatalog(snap, out, wrong, NOW, { gameDataDir })).rejects.toThrow(
      /no table Nope/,
    );
  });
});

describe("pipelineRevisionOf", () => {
  it("reads the revision and rejects ids without one", () => {
    expect(pipelineRevisionOf("poe2-0.1+r7")).toBe(7);
    expect(() => pipelineRevisionOf("poe2-0.1")).toThrow(/\+r<revision>/);
  });
});
