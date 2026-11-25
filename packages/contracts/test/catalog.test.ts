import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  Ascendancy,
  BaseItem,
  CatalogDiff,
  CatalogManifest,
  CatalogShard,
  DataRelease,
  Mod,
  PassiveGroup,
  PassiveNode,
  StatRange,
  UniqueModLine,
  StatTranslation,
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

describe("DataRelease progression facts", () => {
  const facts = {
    maxCharacterLevel: { value: 50, origin: "game-data" },
    passivePoints: {
      mainTree: { perLevel: 1, fromLevel: 2, origin: "pob-code" },
      weaponSetByAct: {
        acts: [
          { act: 1, areaLevel: 5, points: 2 },
          { act: 2, areaLevel: 9, points: 2 },
        ],
        origin: "pob-data",
      },
    },
  };

  it("accepts a release without the facts (older pipelines)", () => {
    expect(DataRelease.safeParse(validRelease).success).toBe(true);
  });

  it("accepts the facts with their origin", () => {
    expect(DataRelease.safeParse({ ...validRelease, ...facts }).success).toBe(true);
  });

  it("rejects a zero level or zero points instead of treating them as data", () => {
    expect(
      DataRelease.safeParse({
        ...validRelease,
        maxCharacterLevel: { value: 0, origin: "game-data" },
      }).success,
    ).toBe(false);
    const zero = {
      ...facts.passivePoints,
      mainTree: { ...facts.passivePoints.mainTree, perLevel: 0 },
    };
    expect(DataRelease.safeParse({ ...validRelease, passivePoints: zero }).success).toBe(false);
  });

  it("rejects an unknown origin, duplicate acts and a start level above the maximum", () => {
    expect(
      DataRelease.safeParse({ ...validRelease, maxCharacterLevel: { value: 50, origin: "memory" } })
        .success,
    ).toBe(false);
    const dup = {
      ...facts.passivePoints,
      weaponSetByAct: {
        ...facts.passivePoints.weaponSetByAct,
        acts: [
          { act: 1, areaLevel: 5, points: 2 },
          { act: 1, areaLevel: 6, points: 2 },
        ],
      },
    };
    expect(DataRelease.safeParse({ ...validRelease, ...facts, passivePoints: dup }).success).toBe(
      false,
    );
    const late = {
      ...facts.passivePoints,
      mainTree: { ...facts.passivePoints.mainTree, fromLevel: 60 },
    };
    const r = DataRelease.safeParse({ ...validRelease, ...facts, passivePoints: late });
    expect(r.error?.issues.map((i) => i.path.join("."))).toContain(
      "passivePoints.mainTree.fromLevel",
    );
  });
});

describe("DataRelease item slots", () => {
  const head = { id: "Fake Head", order: 1, label: "Fake Head", itemClasses: ["Fake Helm"] };
  const hand = {
    id: "Fake Hand",
    order: 2,
    label: "Fake Hand",
    weaponSet: 1,
    itemClasses: ["Fake Blade", "Fake Wand"],
    dependsOnSlot: "Fake Main",
    optional: true,
  };
  const slots = { origin: "pob-code", slots: [head, hand] };

  it("accepts release classifications and rejects duplicates and empty lists", () => {
    const ok = { origin: "pob-code", damageTypes: ["FakeA", "FakeB"], defenceLayers: ["FakeC"] };
    expect(DataRelease.safeParse({ ...validRelease, classifications: ok }).success).toBe(true);
    const dup = { ...ok, damageTypes: ["FakeA", "FakeA"] };
    expect(DataRelease.safeParse({ ...validRelease, classifications: dup }).success).toBe(false);
    const none = { ...ok, defenceLayers: [] };
    expect(DataRelease.safeParse({ ...validRelease, classifications: none }).success).toBe(false);
  });

  it("accepts slots with the item classes they take", () => {
    expect(DataRelease.safeParse({ ...validRelease, itemSlots: slots }).success).toBe(true);
  });

  it("accepts a slot that takes only some bases of a class", () => {
    const flask = {
      id: "Fake Flask",
      order: 1,
      label: "F",
      itemClasses: [],
      partialBases: ["Fake Life Flask"],
    };
    expect(
      DataRelease.safeParse({ ...validRelease, itemSlots: { origin: "pob-code", slots: [flask] } })
        .success,
    ).toBe(true);
  });

  it("rejects duplicate slots, slots that take nothing and a bad weapon set", () => {
    const dup = { ...slots, slots: [head, head] };
    expect(DataRelease.safeParse({ ...validRelease, itemSlots: dup }).success).toBe(false);
    const none = { ...slots, slots: [{ ...head, itemClasses: [] }] };
    expect(DataRelease.safeParse({ ...validRelease, itemSlots: none }).success).toBe(false);
    const set3 = { ...slots, slots: [{ ...hand, weaponSet: 3 }] };
    expect(DataRelease.safeParse({ ...validRelease, itemSlots: set3 }).success).toBe(false);
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

  it("reports an invalid id as issue instead of throwing", () => {
    const r = DataRelease.safeParse({ ...validRelease, id: "bogus" });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join("."))).toContain("id");
  });

  it("rejects diff paths that escape the release", () => {
    expect(DataRelease.safeParse({ ...validRelease, diffPath: "../x.json" }).success).toBe(false);
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

  it("property ranges require min <= max", () => {
    const props = { fixture_range: { min: 3, max: 1 } };
    expect(BaseItem.safeParse({ ...base, properties: props }).success).toBe(false);
  });

  it("StatTranslation needs one condition per stat", () => {
    const t = {
      id: "fixture_translation",
      statIds: ["fixture_stat_a", "fixture_stat_b"],
      lang: "en",
      variants: [{ conditions: [{}], template: "Fixture {0} {1}" }],
    };
    expect(StatTranslation.safeParse(t).success).toBe(false);
    const ok = { ...t, variants: [{ conditions: [{}, {}], template: "Fixture {0} {1}" }] };
    expect(StatTranslation.safeParse(ok).success).toBe(true);
  });

  it("mods need at least one domain and keep unresolved lines visible", () => {
    const mod = (fixture.shards[1] as { entities: Record<string, unknown>[] }).entities[0];
    expect(Mod.safeParse({ ...mod, domains: [] }).success).toBe(false);
    const withUnresolved = {
      ...mod,
      unresolved: [{ text: "Fixture unresolved line", reason: "ambiguous" }],
    };
    expect(Mod.parse(withUnresolved).unresolved).toHaveLength(1);
    const badReason = { ...mod, unresolved: [{ text: "x", reason: "guessed" }] };
    expect(Mod.safeParse(badReason).success).toBe(false);
  });

  it("unresolved defaults to [] and also exists on unique mod lines", () => {
    const mod = (fixture.shards[1] as { entities: Record<string, unknown>[] }).entities[0];
    expect(Mod.parse(mod).unresolved).toEqual([]);
    const line = { stats: [], unresolved: [{ text: "Fixture line", reason: "lossy" }] };
    expect(UniqueModLine.parse(line).unresolved).toHaveLength(1);
    const bad = { stats: [], unresolved: [{ text: "Fixture line", reason: "guessed" }] };
    expect(UniqueModLine.safeParse(bad).success).toBe(false);
  });

  it("ascendancy point unlocks may be absent", () => {
    const asc = {
      id: "fixture_asc",
      name: "Fixture Ascendancy",
      classId: "fixture_class",
      nodeIds: ["fixture_node_1"],
    };
    expect(Ascendancy.safeParse(asc).error).toBeUndefined();
  });

  it("passive nodes carry an optional point and arcs defaulting to []", () => {
    const node = {
      id: "1",
      name: "Made-up Node",
      kind: "small",
      stats: [],
      position: { groupId: "g1", orbit: 0, orbitIndex: 0 },
      connections: ["2"],
    };
    const parsed = PassiveNode.parse(node);
    expect(parsed.arcs).toEqual([]);
    expect(parsed.position).not.toHaveProperty("point");
    const withGeometry = PassiveNode.parse({
      ...node,
      position: { ...node.position, point: { x: -1.5, y: 2 } },
      arcs: [{ to: "2", center: { x: 0, y: 5 }, radius: 10 }],
    });
    expect(withGeometry.position.point).toEqual({ x: -1.5, y: 2 });
    expect(
      PassiveNode.safeParse({ ...node, arcs: [{ to: "2", center: { x: 0, y: 0 }, radius: 0 }] })
        .success,
    ).toBe(false);
    expect(PassiveNode.safeParse({ ...node, arcs: [{ to: "2", radius: 5 }] }).success).toBe(false);
  });

  it("passive groups need a centre and non-negative orbit radii", () => {
    const group = { id: "g1", center: { x: 0, y: 0 }, orbitRadii: [0, 10] };
    expect(PassiveGroup.parse(group)).toEqual(group);
    expect(PassiveGroup.safeParse({ ...group, orbitRadii: [-1] }).success).toBe(false);
    expect(PassiveGroup.safeParse({ id: "g1", orbitRadii: [] }).success).toBe(false);
  });

  it("drop level may be absent instead of guessed", () => {
    expect(BaseItem.safeParse(without(base ?? {}, "dropLevel")).success).toBe(true);
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

  it("rejects a diff of a release against itself", () => {
    const d = { ...(fixture.diff as object), to: "poe2-9.8.7+r2" };
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
