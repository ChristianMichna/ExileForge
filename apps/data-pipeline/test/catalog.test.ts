import { describe, expect, it } from "vitest";
import {
  disambiguate,
  normalizeCatalog,
  normalizeConfigSchema,
  spawnIndexOf,
} from "../src/normalize/catalog.ts";
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
    expect(byId(entities.passiveNode, "2")).toMatchObject({
      unresolved: [{ text: "Something unknowable", reason: "unmatched" }],
    });
    expect(byId(entities.passiveNode, "1")).toMatchObject({ unresolved: [] });
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
    // connection orbit -1: centre on the right of the chord 1 → 2, as in PoB
    expect(byId(entities.passiveNode, "1")).toMatchObject({
      position: { groupId: "1", orbit: 0, orbitIndex: 0, point: { x: 100, y: 200 } },
      arcs: [{ to: "2", center: { x: 91.34, y: 205 }, radius: 10 }],
    });
    // orbit 1, angle π: below the centre (y grows downwards); connection orbit
    // 0 on the same orbit of the same group: arc around the group centre
    expect(byId(entities.passiveNode, "2")).toMatchObject({
      position: { point: { x: 100, y: 210 } },
      arcs: [{ to: "5", center: { x: 100, y: 200 }, radius: 10 }],
    });
    expect(entities.passiveGroup).toEqual([
      { id: "1", center: { x: 100, y: 200 }, orbitRadii: [0, 10] },
      { id: "2", center: { x: -50, y: 0 }, orbitRadii: [0] },
    ]);
  });

  const withConnection = (orbit: number, orbitIndex = 2) => {
    const raw = rawSnapshot();
    const n1 = raw.passiveTree["1"] as { data: Record<string, unknown> };
    n1.data = { ...n1.data, connections: [{ id: 2, orbit }] };
    const n2 = raw.passiveTree["2"] as { data: Record<string, unknown> };
    n2.data = { ...n2.data, orbitIndex, connections: [] };
    return run(raw);
  };

  it("puts the arc centre on the other side for a positive connection orbit", () => {
    expect(byId(withConnection(1).entities.passiveNode, "1")).toMatchObject({
      arcs: [{ to: "2", center: { x: 108.66, y: 205 }, radius: 10 }],
    });
  });

  it("draws straight lines where PoB does, without warnings", () => {
    // orbit unknown to the constants (PoB data uses a placeholder value)
    const unknown = withConnection(2147483647);
    expect(byId(unknown.entities.passiveNode, "1")).toMatchObject({ arcs: [], connections: ["2"] });
    expect(unknown.warnings.filter((w) => /orbit/.test(w.message))).toEqual([]);
    // same orbit across groups would need an arc; nodes further apart than the
    // diameter of the connection orbit stay straight
    const raw = rawSnapshot();
    const n3 = raw.passiveTree["3"] as { data: Record<string, unknown> };
    n3.data = { ...n3.data, connections: [{ id: 1, orbit: 1 }] };
    expect(byId(run(raw).entities.passiveNode, "3")).toMatchObject({ arcs: [] });
  });

  it("leaves a node without point and names the reason when its orbit is unknown", () => {
    const raw = rawSnapshot();
    const node = raw.passiveTree["2"] as { data: Record<string, unknown> };
    node.data = { ...node.data, orbit: 5 };
    const res = run(raw);
    const n = byId<{ id: string; position: object }>(res.entities.passiveNode, "2");
    expect(n?.position).not.toHaveProperty("point");
    expect(res.warnings).toContainEqual({
      kind: "passiveNode",
      id: "2",
      message: "no tree position: orbit 5 index 2 not in the tree constants",
    });
  });

  it("reports a group without centre as an error", () => {
    const raw = rawSnapshot();
    raw.passiveTree["group:2"] = { kind: "group", data: { orbits: [0] } };
    expect(run(raw).errors).toContainEqual({
      kind: "passiveGroup",
      id: "2",
      message: "source has no x/y",
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

  it("reports missing tree constants once as an error, not per node", () => {
    const raw = rawSnapshot();
    delete raw.passiveTree.constants;
    const res = run(raw);
    expect(res.errors).toContainEqual({
      kind: "passiveGroup",
      id: "constants",
      message: "source has no tree constants",
    });
    expect(res.warnings.filter((w) => w.message.startsWith("no tree position"))).toEqual([]);
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

  it("reports a node in an unknown group and an arc that is not a connection", () => {
    const { entities } = run();
    const node = byId<{ id: string; position: { groupId: string }; arcs: unknown[] }>(
      entities.passiveNode,
      "3",
    );
    if (!node) throw new Error("fixture node 3 missing");
    node.position.groupId = "404";
    node.arcs = [{ to: "1", center: { x: 0, y: 0 }, radius: 10 }];
    expect(validateCatalog(entities).errors).toEqual([
      { kind: "passiveNode", id: "3", message: 'position.groupId → unknown passiveGroup "404"' },
      { kind: "passiveNode", id: "3", message: "arcs → 1 is not a connection" },
    ]);
  });

  it("does not resolve references to an entity that violates its contract", () => {
    const { entities } = run();
    (byId(entities.baseItem, "Fake Ring") as unknown as { itemClass: string }).itemClass = "";
    const messages = validateCatalog(entities).errors.map((e) => e.message);
    expect(messages).toContain('baseItemId → unknown baseItem "Fake Ring"');
  });
});

describe("disambiguate", () => {
  const res = {
    status: "ambiguous" as const,
    line: "(5-10)% increased Glow",
    descriptionIds: ["d:1", "d:2"],
    candidates: [
      { descriptionId: "d:1", stats: [{ statId: "glow", min: 5, max: 10 }] },
      { descriptionId: "d:2", stats: [{ statId: "local_glow", min: 5, max: 10 }] },
    ],
  };
  const mod = (statId: string, weights: [string, number][]) => ({
    stats: [{ statId }],
    spawnWeights: weights.map(([tag, weight]) => ({ tag, weight })),
  });
  const spawn = spawnIndexOf([
    mod("glow", [["gloves", 1000]]),
    mod("local_glow", [
      ["bow", 0],
      ["weapon", 1000],
    ]),
  ]);

  it("takes the one candidate whose stat can spawn on the base", () => {
    expect(disambiguate(res, new Set(["weapon", "sword"]), spawn)).toEqual({
      status: "matched",
      descriptionId: "d:2",
      stats: [{ statId: "local_glow", min: 5, max: 10 }],
    });
    expect(disambiguate(res, new Set(["gloves"]), spawn)).toMatchObject({
      descriptionId: "d:1",
    });
  });

  it("lets the first listed tag the base has decide, so a weight of 0 cancels", () => {
    expect(disambiguate(res, new Set(["bow", "weapon"]), spawn)).toBeUndefined();
  });

  it("stays ambiguous with evidence for both, without a base or without candidates", () => {
    expect(disambiguate(res, new Set(["gloves", "weapon"]), spawn)).toBeUndefined();
    expect(disambiguate(res, undefined, spawn)).toBeUndefined();
    expect(
      disambiguate(
        { status: "ambiguous", line: res.line, descriptionIds: res.descriptionIds },
        new Set(["weapon"]),
        spawn,
      ),
    ).toBeUndefined();
  });

  it("is wired through normalizeCatalog and counted", () => {
    const raw = rawSnapshot();
    const text = "{0}% increased Glow";
    raw.statDescriptions[`${scope}:91`] = {
      scope,
      order: 91,
      stats: ["fake_glow"],
      tradeHash: 91,
      variants: [{ limit: [["#", "#"]], text, handlers: [] }],
    };
    raw.statDescriptions[`${scope}:92`] = {
      scope,
      order: 92,
      stats: ["fake_local_glow"],
      tradeHash: 92,
      variants: [{ limit: [["#", "#"]], text, handlers: [] }],
    };
    const glowMod = (hash: string, weightKey: string[], weightVal: number[]) => ({
      "1": "(5-10)% increased Glow",
      type: "Prefix",
      group: `G${hash}`,
      level: 1,
      domains: ["Item"],
      weightKey,
      weightVal,
      modTags: [],
      tradeHashes: { [hash]: ["(5-10)% increased Glow"] },
    });
    raw.mods.GlobalGlow = glowMod("91", ["ring", "default"], [1000, 0]);
    raw.mods.LocalGlow = glowMod("92", ["sword", "default"], [1000, 0]);
    raw.uniques["Glowing Ring, Fake Ring"] = {
      title: "Glowing Ring",
      baseName: "Fake Ring",
      variants: [],
      implicitModLines: {},
      explicitModLines: [{ line: "(5-10)% increased Glow" }],
    };
    raw.uniques["Glowing Charm, Odd Charm"] = {
      title: "Glowing Charm",
      baseName: "Odd Charm",
      variants: [],
      implicitModLines: {},
      explicitModLines: [{ line: "(5-10)% increased Glow" }],
    };
    const { entities, summary } = run(raw);
    const ring = byId<{
      id: string;
      mods: { stats: { statId: string }[]; unresolved?: unknown[] }[];
    }>(entities.uniqueItem, "Glowing Ring, Fake Ring");
    expect(ring?.mods[0]?.stats.map((st) => st.statId)).toEqual(["fake_glow"]);
    const charm = byId<{ id: string; mods: { unresolved?: { reason: string }[] }[] }>(
      entities.uniqueItem,
      "Glowing Charm, Odd Charm",
    );
    expect(charm?.mods[0]?.unresolved?.[0]?.reason).toBe("ambiguous");
    expect(summary.uniqueLinesDisambiguated).toBe(1);
  });
});

describe("unique lines that allocate a passive", () => {
  const unique = (lines: string[]) => ({
    title: "Allocator",
    baseName: "Fake Ring",
    variants: [],
    implicitModLines: {},
    explicitModLines: lines.map((line) => ({ line })),
  });

  it("maps a unique node name to its id and counts it", () => {
    const raw = rawSnapshot();
    raw.uniques["Allocator, Fake Ring"] = unique(["Allocates Big"]);
    const { entities, summary, errors } = run(raw);
    const node = byId<{ id: string; name: string }>(entities.passiveNode, "2");
    expect(node?.name).toBe("Big");
    const [mod] =
      byId<{ id: string; mods: Record<string, unknown>[] }>(
        entities.uniqueItem,
        "Allocator, Fake Ring",
      )?.mods ?? [];
    expect(mod).toEqual({ stats: [], text: "Allocates Big", allocatesNodeId: "2" });
    expect(summary.uniqueLinesAllocatingNode).toBe(1);
    expect(errors).toEqual([]);
    expect(validateCatalog(entities).errors).toEqual([]);
  });

  it("keeps an unknown or shared name visible as unresolved", () => {
    const raw = rawSnapshot();
    raw.uniques["Allocator, Fake Ring"] = unique(["Allocates Nowhere"]);
    const { entities, summary } = run(raw);
    const [mod] =
      byId<{ id: string; mods: Record<string, unknown>[] }>(
        entities.uniqueItem,
        "Allocator, Fake Ring",
      )?.mods ?? [];
    expect(mod).toMatchObject({ unresolved: [{ text: "Allocates Nowhere", reason: "unmatched" }] });
    expect(mod).not.toHaveProperty("allocatesNodeId");
    expect(summary.uniqueLinesAllocatingNode).toBe(0);
  });

  it("reports a name shared by several nodes as ambiguous and keeps the variants", () => {
    const raw = rawSnapshot();
    const tree = raw.passiveTree as Record<string, { kind: string; data: Record<string, unknown> }>;
    const big = tree["2"];
    if (!big) throw new Error("fixture node Big missing");
    tree["900"] = { kind: "node", data: { ...big.data, skill: 900, connections: [] } };
    raw.uniques["Allocator, Fake Ring"] = {
      ...unique(["Allocates Big"]),
      variants: ["Old", "New"],
      explicitModLines: [{ line: "Allocates Big", variants: [2] }],
    };
    const { entities, summary, warnings } = run(raw);
    const [mod] =
      byId<{ id: string; mods: Record<string, unknown>[] }>(
        entities.uniqueItem,
        "Allocator, Fake Ring",
      )?.mods ?? [];
    expect(mod).toMatchObject({
      unresolved: [{ text: "Allocates Big", reason: "ambiguous" }],
      variantIds: ["2"],
    });
    expect(mod).not.toHaveProperty("allocatesNodeId");
    expect(summary.uniqueLinesAllocatingNode).toBe(0);
    expect(warnings.map((w) => w.message).join("\n")).toMatch(/2 nodes named "Big"/);
  });

  it("keeps variants on a resolved allocates line", () => {
    const raw = rawSnapshot();
    raw.uniques["Allocator, Fake Ring"] = {
      ...unique([]),
      variants: ["Old", "New"],
      explicitModLines: [{ line: "Allocates Big", variants: [2] }],
    };
    const { entities } = run(raw);
    const [mod] =
      byId<{ id: string; mods: Record<string, unknown>[] }>(
        entities.uniqueItem,
        "Allocator, Fake Ring",
      )?.mods ?? [];
    expect(mod).toMatchObject({ allocatesNodeId: "2", variantIds: ["2"] });
  });

  it("requires a capture group in the pattern", () => {
    const bad = { ...cfg, uniqueLines: { allocatesPattern: "^Allocates .+$" } };
    expect(normalizeConfigSchema.safeParse(bad).success).toBe(false);
    expect(
      normalizeConfigSchema.safeParse({ ...cfg, uniqueLines: { allocatesPattern: "(" } }).success,
    ).toBe(false);
  });

  it("rejects an allocated node that is not in the catalog", () => {
    const { entities } = run();
    (entities.uniqueItem[0] as { mods: Record<string, unknown>[] }).mods.push({
      stats: [],
      allocatesNodeId: "404",
    });
    expect(validateCatalog(entities).errors.map((e) => e.message)).toContain(
      'mods.allocatesNodeId → unknown passiveNode "404"',
    );
  });
});
