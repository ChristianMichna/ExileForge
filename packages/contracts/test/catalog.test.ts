import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BaseItem,
  CatalogDiff,
  CatalogManifest,
  CatalogShard,
  DataRelease,
  StatRange,
} from "../src/index.js";
import { without } from "./helpers.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/catalog-release.json", import.meta.url), "utf8"),
) as { manifest: unknown; shards: unknown[]; diff: unknown };

const validRelease = (fixture.manifest as { release: Record<string, unknown> }).release;

describe("catalog fixture release", () => {
  it("manifest, shards and diff validate", () => {
    expect(CatalogManifest.safeParse(fixture.manifest).error).toBeUndefined();
    for (const shard of fixture.shards) {
      expect(CatalogShard.safeParse(shard).error).toBeUndefined();
    }
    expect(CatalogDiff.safeParse(fixture.diff).error).toBeUndefined();
  });

  it("shard entities are typed by kind", () => {
    const shard = CatalogShard.parse(fixture.shards[1]);
    if (shard.kind !== "mod") throw new Error("expected mod shard");
    expect(shard.entities[0]?.tags).toEqual([]); // default applied
  });

  it("a shard with an entity of the wrong kind is rejected", () => {
    const [baseShard, modShard] = fixture.shards as [
      { entities: unknown[] },
      { entities: unknown[] },
    ];
    const mixed = { ...baseShard, entities: modShard.entities };
    expect(CatalogShard.safeParse(mixed).success).toBe(false);
  });
});

describe("DataRelease", () => {
  it("rejects a gameVersion that does not match the id", () => {
    const r = DataRelease.safeParse({ ...validRelease, gameVersion: "9.8.6" });
    expect(r.error?.issues.map((i) => i.path.join("."))).toContain("gameVersion");
  });

  it("rejects a revision that does not match the id", () => {
    const r = DataRelease.safeParse({ ...validRelease, pipelineRevision: 4 });
    expect(r.error?.issues.map((i) => i.path.join("."))).toContain("pipelineRevision");
  });

  it("rejects a diff without previous release", () => {
    expect(DataRelease.safeParse(without(validRelease, "previousReleaseId")).success).toBe(false);
  });

  it("rejects malformed source hashes", () => {
    const r = DataRelease.safeParse({ ...validRelease, sourceHashes: { x: "abc" } });
    expect(r.success).toBe(false);
  });
});

describe("CatalogManifest", () => {
  it("rejects duplicate shard kinds", () => {
    const m = fixture.manifest as { shards: unknown[] };
    const dup = { ...m, shards: [m.shards[0], m.shards[0]] };
    expect(CatalogManifest.safeParse(dup).success).toBe(false);
  });
});

describe("entities", () => {
  const base = (fixture.shards[0] as { entities: Record<string, unknown>[] }).entities[0];

  it("strip unknown fields so older apps can read newer releases", () => {
    const parsed = BaseItem.parse({ ...base, futureField: true });
    expect(parsed).not.toHaveProperty("futureField");
  });

  it("reject icon paths that escape the release", () => {
    expect(BaseItem.safeParse({ ...base, icon: "../secret.png" }).success).toBe(false);
    expect(BaseItem.safeParse({ ...base, icon: "/abs.png" }).success).toBe(false);
  });

  it("StatRange requires min <= max", () => {
    expect(StatRange.safeParse({ statId: "s", min: 2, max: 1 }).success).toBe(false);
    expect(StatRange.safeParse({ statId: "s", min: 1, max: 1 }).success).toBe(true);
  });
});

describe("CatalogDiff", () => {
  it("rejects field paths that are not JSON pointers", () => {
    const d = structuredClone(fixture.diff) as {
      kinds: { mod: { changed: { fields: { path: string }[] }[] } };
    };
    const field = d.kinds.mod.changed[0]?.fields[0];
    if (!field) throw new Error("fixture changed");
    field.path = "stats.0.max";
    expect(CatalogDiff.safeParse(d).success).toBe(false);
  });

  it("rejects unknown entity kinds", () => {
    const d = {
      ...(fixture.diff as object),
      kinds: { weapon: { added: [], removed: [], changed: [] } },
    };
    expect(CatalogDiff.safeParse(d).success).toBe(false);
  });
});
