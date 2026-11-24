import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeCatalog, normalizeConfigSchema } from "../src/normalize/catalog.ts";
import { StatMatcher } from "../src/normalize/stat-matcher.ts";
import { validateCatalog } from "../src/normalize/validate.ts";

// Synthetic raw snapshot in PoB's shape. All names, ids and texts are invented.
const cfg = normalizeConfigSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../config/data-pipeline/normalize.json", import.meta.url)),
      "utf8",
    ),
  ),
);
const scope = cfg.statScopes.mod;

const statDescriptions = {
  [`${scope}:1`]: {
    scope,
    order: 1,
    stats: ["fake_alpha"],
    tradeHash: 11,
    variants: [{ limit: [["#", "#"]], text: "{0:+d} to Alpha", handlers: [] }],
  },
  [`${cfg.statScopes.passiveNode}:1`]: {
    scope: cfg.statScopes.passiveNode,
    order: 1,
    parent: scope,
    stats: ["fake_node_stat"],
    tradeHash: 21,
    variants: [{ limit: [["#", "#"]], text: "{0}% more Node Power", handlers: [] }],
  },
};

function rawSnapshot() {
  return {
    statDescriptions,
    mods: {
      AlphaLow: {
        "1": "+(1-2) to Alpha",
        type: "Prefix",
        group: "Alpha",
        level: 1,
        domains: ["Item"],
        weightKey: ["thing", "default"],
        weightVal: [1, 0],
        modTags: ["fake"],
        tradeHashes: { "11": ["+(1-2) to Alpha"] },
      },
      AlphaHigh: {
        "1": "+(3-4) to Alpha",
        type: "Prefix",
        group: "Alpha",
        level: 30,
        domains: ["Item"],
        weightKey: ["thing"],
        weightVal: [1],
        modTags: {},
        tradeHashes: { "11": ["+(3-4) to Alpha"] },
      },
      Mystery: {
        "1": "Does Something Odd",
        domains: ["Exclusive"],
        weightKey: {},
        weightVal: {},
        modTags: {},
      },
      ImplicitAlpha: {
        "1": "+5 to Alpha",
        type: "Implicit",
        group: "AlphaImp",
        level: 1,
        domains: ["Item"],
        weightKey: {},
        weightVal: {},
        modTags: {},
      },
    },
    itemBases: {
      "Fake Ring": {
        type: "Ring",
        tags: { ring: true, default: true, unused: false },
        implicit: "+5 to Alpha",
        req: { level: 4, str: 7 },
      },
      "Fake Blade": {
        type: "Sword",
        tags: {},
        req: {},
        weapon: { PhysicalMin: 1, PhysicalMax: 3 },
        socketLimit: 2,
      },
      "Odd Charm": { type: "Charm", tags: {}, req: {}, implicit: "Grants Nothing Known" },
    },
    uniques: {
      "Fakebrand, Fake Ring": {
        title: "Fakebrand",
        baseName: "Fake Ring",
        variants: ["Old", "New"],
        implicitModLines: {},
        explicitModLines: [
          { line: "+(7-9) to Alpha", variants: [2] },
          { line: "Grants the Unknowable" },
        ],
      },
      "Lostbrand, Missing Base": {
        title: "Lostbrand",
        baseName: "Missing Base",
        implicitModLines: {},
        explicitModLines: {},
      },
    },
    gems: {
      "Metadata/Fake/GemA": {
        name: "Gem A",
        gameId: "Metadata/Fake/Game/GemA",
        gemType: "Spell",
        tags: { spell: true },
      },
    },
    gemLevels: {
      "Metadata/Fake/GemA": {
        levels: [
          { level: 1, levelRequirement: 0, attributes: { int: 0 }, values: { "cost.Mana": 5 } },
          { level: 2, levelRequirement: 3, attributes: { int: 9 }, values: { "cost.Mana": 6 } },
        ],
      },
    },
    passiveTree: {
      "1": {
        kind: "node",
        data: {
          skill: 1,
          name: "Start",
          group: 1,
          orbit: 0,
          orbitIndex: 0,
          stats: {},
          classesStart: ["Fakeclass", "Ghostclass"],
          connections: [{ id: 2 }, { id: 99 }],
        },
      },
      "2": {
        kind: "node",
        data: {
          skill: 2,
          name: "Big",
          isNotable: true,
          group: 1,
          orbit: 1,
          orbitIndex: 2,
          stats: ["10% more Node Power", "Something unknowable"],
          connections: [{ id: 1 }],
        },
      },
      "3": {
        kind: "node",
        data: {
          skill: 3,
          name: "Asc Start",
          isAscendancyStart: true,
          ascendancyName: "Fake Ascent",
          group: 2,
          orbit: 0,
          orbitIndex: 0,
          stats: {},
          connections: {},
        },
      },
      "class:Fakeclass": {
        kind: "class",
        index: 1,
        data: {
          name: "Fakeclass",
          base_str: 7,
          base_dex: 9,
          ascendancies: [{ id: "FakeAscent", internalId: "Fakeclass1", name: "Fake Ascent" }],
        },
      },
    },
  };
}

function run(raw = rawSnapshot()) {
  const matcher = new StatMatcher(raw.statDescriptions);
  return normalizeCatalog(raw, { mod: matcher, passiveNode: matcher }, cfg);
}

describe("normalizeCatalog", () => {
  const { entities, findings } = run();
  const byId = <T extends { id: string }>(list: unknown[], id: string) =>
    (list as T[]).find((e) => e.id === id);

  it("maps mods with stats, tiers, weights and visible unresolved lines", () => {
    expect(byId(entities.mod, "AlphaHigh")).toMatchObject({
      tier: 1,
      stats: [{ statId: "fake_alpha", min: 3, max: 4 }],
      requiredLevel: 30,
    });
    expect(byId(entities.mod, "AlphaLow")).toMatchObject({
      tier: 2,
      spawnWeights: [
        { tag: "thing", weight: 1 },
        { tag: "default", weight: 0 },
      ],
      tags: ["fake"],
    });
    expect(byId(entities.mod, "Mystery")).toMatchObject({
      generationType: cfg.modGenerationTypeFallback,
      stats: [],
      unresolved: [{ text: "Does Something Odd", reason: "unmatched" }],
    });
    expect(byId(entities.mod, "ImplicitAlpha")).not.toHaveProperty("tier");
  });

  it("maps bases with name ids, true tags, properties and the implicit mod", () => {
    expect(byId(entities.baseItem, "Fake Ring")).toEqual({
      id: "Fake Ring",
      name: "Fake Ring",
      itemClass: "Ring",
      tags: ["default", "ring"],
      requirements: { level: 4, attributes: { str: 7 } },
      implicitModIds: ["ImplicitAlpha"],
      properties: {},
    });
    expect(byId(entities.baseItem, "Fake Blade")).toMatchObject({
      properties: { "weapon.PhysicalMin": 1, "weapon.PhysicalMax": 3 },
      socketCapacity: 2,
    });
    expect(findings).toContainEqual({
      kind: "baseItem",
      id: "Odd Charm",
      message: 'implicit "Grants Nothing Known" matches 0 mods',
    });
  });

  it("maps uniques with variants and keeps unknown lines visible", () => {
    expect(byId(entities.uniqueItem, "Fakebrand, Fake Ring")).toEqual({
      id: "Fakebrand, Fake Ring",
      name: "Fakebrand",
      baseItemId: "Fake Ring",
      variants: [
        { id: "1", name: "Old" },
        { id: "2", name: "New" },
      ],
      mods: [
        {
          text: "+(7-9) to Alpha",
          stats: [{ statId: "fake_alpha", min: 7, max: 9 }],
          variantIds: ["2"],
        },
        {
          text: "Grants the Unknowable",
          stats: [],
          unresolved: [{ text: "Grants the Unknowable", reason: "unmatched" }],
        },
      ],
    });
  });

  it("maps gems by game id with PoB-computed levels", () => {
    expect(entities.gem).toEqual([
      {
        id: "Metadata/Fake/Game/GemA",
        name: "Gem A",
        kind: "Spell",
        tags: ["spell"],
        levels: [
          {
            level: 1,
            requirements: { level: 0, attributes: { int: 0 } },
            stats: { "cost.Mana": 5 },
          },
          {
            level: 2,
            requirements: { level: 3, attributes: { int: 9 } },
            stats: { "cost.Mana": 6 },
          },
        ],
      },
    ]);
  });

  it("maps the tree, drops dangling references and reports them", () => {
    expect(byId(entities.passiveNode, "1")).toMatchObject({
      kind: cfg.passiveNodeKinds.default,
      connections: ["2"],
      classStartFor: ["Fakeclass"],
    });
    expect(byId(entities.passiveNode, "2")).toMatchObject({
      kind: "notable",
      stats: [
        { statId: "fake_node_stat", text: "10% more Node Power" },
        { text: "Something unknowable" },
      ],
    });
    expect(byId(entities.passiveNode, "3")).toMatchObject({
      kind: "ascendancyStart",
      ascendancyId: "Fakeclass1",
    });
    expect(entities.characterClass).toEqual([
      {
        id: "Fakeclass",
        name: "Fakeclass",
        baseAttributes: { str: 7, dex: 9 },
        startNodeId: "1",
        ascendancyIds: ["Fakeclass1"],
      },
    ]);
    expect(entities.ascendancy).toEqual([
      {
        id: "Fakeclass1",
        name: "Fake Ascent",
        classId: "Fakeclass",
        startNodeId: "3",
        nodeIds: ["3"],
      },
    ]);
    expect(findings).toContainEqual({
      kind: "passiveNode",
      id: "1",
      message: "connection to missing node 99 dropped",
    });
    expect(findings).toContainEqual({
      kind: "passiveNode",
      id: "1",
      message: 'start node for unknown class "Ghostclass" dropped',
    });
  });

  it("builds stat translations with conditions and formatters", () => {
    expect(byId(entities.statTranslation, `${scope}:1`)).toEqual({
      id: `${scope}:1`,
      statIds: ["fake_alpha"],
      lang: cfg.lang,
      variants: [
        { conditions: [{ negated: false }], template: "{0} to Alpha", formatters: ["+d"] },
      ],
    });
  });

  it("rejects mismatched weight lists", () => {
    const raw = rawSnapshot();
    raw.mods.AlphaLow.weightVal = [1];
    expect(() => run(raw)).toThrow(/weightKey and weightVal/);
  });
});

describe("validateCatalog", () => {
  it("passes the synthetic catalog except the unique with a missing base", () => {
    const { errors } = validateCatalog(run().entities);
    expect(errors).toEqual([
      {
        kind: "uniqueItem",
        id: "Lostbrand, Missing Base",
        message: 'baseItemId → unknown baseItem "Missing Base"',
      },
    ]);
  });

  it("reports contract violations and duplicate ids", () => {
    const { entities } = run();
    entities.gem.push({ ...(entities.gem[0] as object) });
    (entities.mod[0] as { stats: unknown[] }).stats = [{ statId: "x", min: 5, max: 1 }];
    const { errors } = validateCatalog(entities);
    expect(errors.map((e) => e.message)).toEqual(
      expect.arrayContaining(["duplicate id", expect.stringMatching(/^contract: stats\.0\.max/)]),
    );
  });
});
