import { describe, expect, it } from "vitest";
import { normalizeCatalog } from "../src/normalize/catalog.ts";
import { StatMatcher } from "../src/normalize/stat-matcher.ts";
import { validateCatalog } from "../src/normalize/validate.ts";
import { cfg, rawSnapshot, type RawFixture } from "./fixtures/raw-catalog.ts";

const scope = cfg.statScopes.mod;

function run(raw: RawFixture = rawSnapshot()) {
  const matcher = new StatMatcher(raw.statDescriptions);
  return normalizeCatalog(
    raw as unknown as Parameters<typeof normalizeCatalog>[0],
    { mod: matcher, passiveNode: matcher },
    cfg,
  );
}

const byId = <T extends { id: string }>(list: unknown[], id: string) =>
  (list as T[]).find((e) => e.id === id);

describe("normalizeCatalog", () => {
  const { entities, warnings, errors, unresolved, hiddenStatGroups, summary } = run();

  it("has no errors on complete source data", () => {
    expect(errors).toEqual([]);
  });

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

  it("lists stat groups that render no text instead of hiding them", () => {
    expect(hiddenStatGroups).toEqual([{ modId: "AlphaLow", tradeHash: "13" }]);
    expect(summary.modsWithHiddenStatGroups).toBe(1);
    expect(summary.modsWithoutGenerationType).toBe(1);
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
    expect(warnings).toContainEqual({
      kind: "baseItem",
      id: "Odd Charm",
      message: 'implicit "Grants Nothing Known" matches 0 mods',
    });
  });

  it("reports an implicit whose text fits several mods", () => {
    const raw = rawSnapshot();
    raw.mods.ImplicitAlphaTwin = { ...raw.mods.ImplicitAlpha };
    const res = run(raw);
    expect(byId(res.entities.baseItem, "Fake Ring")).toMatchObject({ implicitModIds: [] });
    expect(res.warnings).toContainEqual({
      kind: "baseItem",
      id: "Fake Ring",
      message: 'implicit "+5 to Alpha" matches 2 mods',
    });
  });

  it("maps uniques, drops unknown variants and keeps unknown lines visible", () => {
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
    expect(warnings).toEqual(
      expect.arrayContaining([
        {
          kind: "uniqueItem",
          id: "Fakebrand, Fake Ring",
          message: 'line "+(7-9) to Alpha": unknown variant 5 dropped',
        },
        {
          kind: "uniqueItem",
          id: "Fakebrand, Fake Ring",
          message: 'line "+1 to Alpha" dropped: none of its variants exist',
        },
      ]),
    );
    expect(summary.unresolved.uniqueItem).toEqual({
      unmatched: 1,
      ambiguous: 0,
      lossy: 0,
      hidden: 0,
    });
  });

  it("maps gems with literal stat-set values keyed by stat id", () => {
    expect(entities.gem).toEqual([
      {
        id: "Metadata/Fake/Game/GemA",
        name: "Gem A",
        kind: "Spell",
        tags: ["spell"],
        levels: [
          {
            level: 1,
            requirements: { attributes: {} },
            stats: { fake_constant: 4, fake_alpha: 10 },
          },
          {
            level: 2,
            requirements: { level: 3, attributes: { int: 9 } },
            stats: { fake_constant: 4, fake_alpha: 12 },
          },
        ],
      },
    ]);
    expect(summary.gemInterpolatedStatValues).toBe(2);
    expect(summary.gemAdditionalStatSets).toBe(1);
    expect(summary.gemLevelFieldsNotInContract).toEqual({ "cost.Mana": 2 });
  });

  it("skips a duplicate gem game id with a warning", () => {
    const raw = rawSnapshot();
    raw.gems["Metadata/Fake/GemACopy"] = { ...raw.gems["Metadata/Fake/GemA"] };
    const res = run(raw);
    expect(res.entities.gem).toHaveLength(1);
    expect(res.warnings).toContainEqual({
      kind: "gem",
      id: "Metadata/Fake/Game/GemA",
      message: "duplicate gameId (PoB gem Metadata/Fake/GemACopy); later entry skipped",
    });
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
    expect(byId(entities.passiveNode, "2")).not.toHaveProperty("unresolved");
    expect(unresolved).toEqual([
      { kind: "passiveNode", id: "2", text: "Something unknowable", reason: "unmatched" },
    ]);
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
        ascendancyIds: ["Fakeclass1", "Fakeclass2"],
      },
    ]);
    expect(byId(entities.ascendancy, "Fakeclass1")).toEqual({
      id: "Fakeclass1",
      name: "Fake Ascent",
      classId: "Fakeclass",
      startNodeId: "3",
      nodeIds: ["3"],
    });
    expect(warnings).toEqual(
      expect.arrayContaining([
        { kind: "passiveNode", id: "1", message: "connection to missing node 99 dropped" },
        {
          kind: "passiveNode",
          id: "1",
          message: 'start node for unknown class "Ghostclass" dropped',
        },
        { kind: "ascendancy", id: "Fakeclass2", message: "no passive nodes in the tree" },
      ]),
    );
  });

  it("places nodes from group centre and orbit tables, with arcs and groups", () => {
    expect(byId(entities.passiveNode, "1")).toMatchObject({
      position: { groupId: "1", orbit: 0, orbitIndex: 0, point: { x: 100, y: 200 } },
      arcs: [{ to: "2", radius: 10, side: -1 }],
    });
    // orbit 1, angle π: below the centre (y grows downwards)
    expect(byId(entities.passiveNode, "2")).toMatchObject({
      position: { point: { x: 100, y: 210 } },
      arcs: [],
    });
    expect(entities.passiveGroup).toEqual([
      { id: "1", center: { x: 100, y: 200 }, orbitRadii: [0, 10] },
      { id: "2", center: { x: -50, y: 0 }, orbitRadii: [0] },
    ]);
  });

  it("leaves a node without point and reports it when its orbit is unknown", () => {
    const raw = rawSnapshot();
    const node = raw.passiveTree["2"] as { data: Record<string, unknown> };
    node.data = { ...node.data, orbit: 5 };
    const res = run(raw);
    const n = byId<{ id: string; position: object }>(res.entities.passiveNode, "2");
    expect(n?.position).not.toHaveProperty("point");
    expect(res.warnings).toContainEqual({
      kind: "passiveNode",
      id: "2",
      message: "no tree position (group or orbit missing in source)",
    });
  });

  it("marks image-only nodes as decoration and never links them, as PoB does", () => {
    const raw = rawSnapshot();
    raw.passiveTree["4"] = {
      kind: "node",
      data: {
        skill: 4,
        name: "Pattern",
        isOnlyImage: true,
        group: 2,
        orbit: 0,
        orbitIndex: 0,
        stats: {},
        connections: [{ id: 1, orbit: 0 }],
      },
    };
    const res = run(raw);
    expect(byId(res.entities.passiveNode, "4")).toMatchObject({
      kind: "decoration",
      connections: [],
    });
    expect(res.warnings.filter((w) => w.id === "4")).toEqual([]);
  });

  it("reports missing tree constants as an error", () => {
    const raw = rawSnapshot();
    delete raw.passiveTree.constants;
    expect(run(raw).errors).toContainEqual({
      kind: "passiveGroup",
      id: "constants",
      message: "source has no tree constants",
    });
  });

  it("builds stat translations, keeps every format code and counts what is skipped", () => {
    expect(byId(entities.statTranslation, `${scope}:1`)).toEqual({
      id: `${scope}:1`,
      statIds: ["fake_alpha"],
      lang: cfg.lang,
      variants: [
        { conditions: [{ negated: false }], template: "{0} to Alpha", formatters: ["+d"] },
      ],
    });
    expect(byId(entities.statTranslation, `${scope}:2`)).toMatchObject({
      variants: [{ template: "{0} Beta", formatters: ["-d"] }],
    });
    expect(byId(entities.statTranslation, `${scope}:3`)).toBeUndefined();
    expect(summary.statTranslations).toEqual({
      descriptions: 4,
      withoutStats: 0,
      withoutVariants: 1,
      gemQualityVariantsSkipped: 1,
      emptyVariantsSkipped: 1,
    });
  });

  it("reports missing required source values as errors, never as 0", () => {
    const raw = rawSnapshot();
    delete raw.mods.AlphaHigh?.level;
    delete raw.itemBases["Fake Blade"]?.type;
    const res = run(raw);
    expect(res.errors).toEqual(
      expect.arrayContaining([
        { kind: "mod", id: "AlphaHigh", message: "source has no level" },
        { kind: "baseItem", id: "Fake Blade", message: "source has no type" },
      ]),
    );
  });

  it("rejects mismatched weight lists", () => {
    const raw = rawSnapshot();
    raw.mods.AlphaLow = { ...raw.mods.AlphaLow, weightVal: [1] };
    expect(() => run(raw)).toThrow(/weightKey and weightVal/);
  });
});

describe("validateCatalog", () => {
  it("passes the synthetic catalog", () => {
    expect(validateCatalog(run().entities).errors).toEqual([]);
  });

  it("reports a unique with a missing base and unknown variant ids", () => {
    const { entities } = run();
    entities.uniqueItem.push({
      id: "Lostbrand, Missing Base",
      name: "Lostbrand",
      baseItemId: "Missing Base",
      mods: [{ stats: [], text: "x", variantIds: ["3"] }],
      variants: [],
    });
    expect(validateCatalog(entities).errors).toEqual([
      {
        kind: "uniqueItem",
        id: "Lostbrand, Missing Base",
        message: 'baseItemId → unknown baseItem "Missing Base"',
      },
      {
        kind: "uniqueItem",
        id: "Lostbrand, Missing Base",
        message: 'variantIds → unknown variant "3"',
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

  it("does not resolve references to an entity that violates its contract", () => {
    const { entities } = run();
    (byId(entities.baseItem, "Fake Ring") as unknown as { itemClass: string }).itemClass = "";
    const messages = validateCatalog(entities).errors.map((e) => e.message);
    expect(messages).toContain('baseItemId → unknown baseItem "Fake Ring"');
  });
});
