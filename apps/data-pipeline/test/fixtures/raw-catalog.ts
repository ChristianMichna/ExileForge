import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeConfigSchema } from "../../src/normalize/catalog.ts";

// Synthetic raw snapshot in PoB's shape. All names, ids, texts and numbers
// are invented; only the field layout follows PoB.
export const cfg = normalizeConfigSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../../config/data-pipeline/normalize.json", import.meta.url)),
      "utf8",
    ),
  ),
);
const scope = cfg.statScopes.mod;

export function rawSnapshot() {
  return {
    statDescriptions: {
      [`${scope}:1`]: {
        scope,
        order: 1,
        stats: ["fake_alpha"],
        tradeHash: 11,
        variants: [{ limit: [["#", "#"]], text: "{0:+d} to Alpha", handlers: [] }],
      },
      [`${scope}:2`]: {
        scope,
        order: 2,
        stats: ["fake_beta"],
        tradeHash: 12,
        variants: [
          { limit: [["#", "#"]], text: "{0:-d} Beta", handlers: [] },
          { limit: [["#", "#"]], text: "Beta of quality {0}", handlers: [], gemQuality: true },
        ],
      },
      [`${scope}:3`]: {
        scope,
        order: 3,
        stats: ["fake_unseen"],
        tradeHash: 13,
        variants: [{ limit: [["#", "#"]], text: "", handlers: [] }],
      },
      [`${cfg.statScopes.passiveNode}:1`]: {
        scope: cfg.statScopes.passiveNode,
        order: 1,
        parent: scope,
        stats: ["fake_node_stat"],
        tradeHash: 21,
        variants: [{ limit: [["#", "#"]], text: "{0}% more Node Power", handlers: [] }],
      },
    } as Record<string, unknown>,
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
        tradeHashes: { "11": ["+(1-2) to Alpha"], "13": [""] },
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
        level: 1,
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
    } as Record<string, Record<string, unknown>>,
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
    } as Record<string, Record<string, unknown>>,
    uniques: {
      "Fakebrand, Fake Ring": {
        title: "Fakebrand",
        baseName: "Fake Ring",
        variants: ["Old", "New"],
        implicitModLines: {},
        explicitModLines: [
          { line: "+(7-9) to Alpha", variants: [2, 5] },
          { line: "Grants the Unknowable" },
          { line: "+1 to Alpha", variants: [7] },
        ],
      },
    } as Record<string, Record<string, unknown>>,
    gems: {
      "Metadata/Fake/GemA": {
        name: "Gem A",
        gameId: "Metadata/Fake/Game/GemA",
        gemType: "Spell",
        tags: { spell: true },
      },
    } as Record<string, Record<string, unknown>>,
    gemLevels: {
      "Metadata/Fake/GemA": {
        grantedEffectId: "FakeEffectA",
        levels: [
          { level: 1, attributes: {}, values: { "cost.Mana": 5 } },
          { level: 2, levelRequirement: 3, attributes: { int: 9 }, values: { "cost.Mana": 6 } },
        ],
      },
    } as Record<string, Record<string, unknown>>,
    skills: {
      FakeEffectA: {
        statSets: [
          {
            constantStats: [["fake_constant", 4]],
            stats: ["fake_alpha", "fake_scaled", "fake_flag"],
            levels: [
              { "1": 10, "2": 0.5, statInterpolation: [1, 3] },
              { "1": 12, "2": 0.6, statInterpolation: [1, 3] },
            ],
          },
          { stats: ["fake_other_mode"], levels: [{ "1": 1, statInterpolation: [1] }] },
        ],
      },
    } as Record<string, Record<string, unknown>>,
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
          connections: [{ id: 2, orbit: -1 }, { id: 99 }],
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
          connections: [{ id: 1 }, { id: 5, orbit: 0 }],
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
      "5": {
        kind: "node",
        data: {
          skill: 5,
          name: "Ring",
          group: 1,
          orbit: 1,
          orbitIndex: 0,
          stats: {},
          connections: {},
        },
      },
      "group:1": { kind: "group", data: { x: 100, y: 200, orbits: [0, 1] } },
      "group:2": { kind: "group", data: { x: -50, y: 0, orbits: [0] } },
      constants: {
        kind: "constants",
        data: {
          orbitRadii: [0, 10],
          orbitAnglesByOrbit: [[0], [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]],
        },
      },
      "class:Fakeclass": {
        kind: "class",
        index: 1,
        data: {
          name: "Fakeclass",
          base_str: 7,
          base_dex: 9,
          ascendancies: [
            { id: "FakeAscent", internalId: "Fakeclass1", name: "Fake Ascent" },
            { id: "Empty", internalId: "Fakeclass2", name: "Empty Ascent" },
          ],
        },
      },
    } as Record<string, Record<string, unknown>>,
  };
}
export type RawFixture = ReturnType<typeof rawSnapshot>;
