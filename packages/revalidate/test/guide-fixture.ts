// A complete, valid GuideDocument (copied from the contracts tests) for revalidation tests.

export const releaseId = "poe2-9.8.7+r3";
const calcOk = { status: "ok", calcId: "calc-1" } as const;
const text = (t: string) => [{ type: "text", text: t }];
const request = {
  dataReleaseId: releaseId,
  skillIdea: "Fixture idea",
  mainSkillId: "Fixture/Gems/Main",
  mode: { hardcore: false, ssf: false },
  budget: { leveling: "tier-a", endgame: "tier-b" },
  preferences: {
    focus: "allround",
    pace: "balanced",
    complexityTolerance: "medium",
  },
};

const state = {
  classId: "fixture_class",
  ascendancyId: "fixture_asc",
  level: 10,
  tree: { allocated: [{ nodeId: "fixture_node_1" }] },
  skills: [
    {
      key: "main",
      role: "main",
      gem: { gemId: "Fixture/Gems/Main", level: 5 },
      supports: [{ gemId: "Fixture/Gems/Support", level: 5 }],
    },
  ],
  items: [{ slot: "FixtureSlot", item: { kind: "unique", uniqueId: "Fixture Unique" } }],
};

const stage = {
  key: "stage-1",
  order: 0,
  label: "Fixture stage",
  kind: "campaign",
  levelRange: [1, 10],
  state,
  allocationOrder: ["fixture_node_1"],
  tasks: [text("Fixture task")],
  calcs: { "fixture-profile": calcOk },
};

const market = {
  kind: "market",
  provider: "fixture-market",
  league: "Fixture League",
  fetchedAt: "2026-01-01T00:00:00Z",
  confidence: "low",
} as const;
const price = {
  status: "ok",
  value: { amount: 1, currencyItemId: "Fixture/Currency/A" },
  source: market,
};
const uncal = { status: "uncalibrated", reason: "no market data" };

const crafting = {
  key: "craft-1",
  slot: "FixtureSlot",
  target: {
    kind: "crafted",
    baseItemId: "Fixture/Items/BaseAlpha",
    rarity: "fixture_rarity",
    mods: [{ modId: "FixtureMod1", required: true }],
  },
  start: { baseItemId: "Fixture/Items/BaseAlpha", itemLevel: 1, cost: uncal },
  steps: [
    {
      order: 0,
      actionIds: ["Fixture/Currency/A"],
      goal: text("Fixture goal"),
      successChance: uncal,
      expectedAttempts: uncal,
      expectedCost: uncal,
      onFail: { action: "goto", order: 0 },
    },
  ],
  expectedTotal: uncal,
};

export const guide = {
  metadata: {
    guideId: "00000000-0000-4000-8000-000000000001",
    revision: 0,
    schemaVersion: 1,
    dataReleaseId: releaseId,
    pobVersion: "v9.9.9",
    generatedAt: "2026-01-01T00:00:00Z",
    models: [{ taskClass: "planner", model: "fixture-model" }],
    promptVersions: { "S2.archetype": "1" },
  },
  request,
  summary: {
    classId: "fixture_class",
    ascendancyId: "fixture_asc",
    mainSkillId: "Fixture/Gems/Main",
    damageTypes: ["fixture_damage"],
    scalingAxes: text("Fixture scaling"),
    defenceLayers: ["fixture_defence"],
    playstyle: text("Fixture playstyle"),
    complexity: "low",
    strengths: [text("Fixture strength")],
    weaknesses: [text("Fixture weakness")],
    budgetRange: { from: "tier-a", to: "tier-b" },
    suitability: { softcore: true, hardcore: false, ssf: true },
  },
  mechanics: {
    explanation: [
      { type: "text", text: "Fixture deals " },
      { type: "calc", ref: { calcId: "calc-1", stat: "FixtureStatA" } },
      { type: "entity", ref: { kind: "gem", id: "Fixture/Gems/Main" } },
    ],
    decisions: [{ reason: text("Fixture reason") }],
  },
  progression: { stages: [stage] },
  gear: {
    tiers: [
      {
        budgetTier: "tier-a",
        slots: [
          {
            slot: "FixtureSlot",
            priority: "core",
            target: state.items[0]?.item,
            acquisition: "drop",
            cost: price,
          },
        ],
        upgradeOrder: [{ slot: "FixtureSlot", gainPerCost: uncal }],
      },
    ],
  },
  crafting: [crafting],
  playstyle: {
    rotation: text("Fixture rotation"),
    mapping: text("Fixture mapping"),
    bossing: text("Fixture bossing"),
    positioning: text("Fixture positioning"),
    bossMechanics: [],
  },
  atlas: { strategy: text("Fixture atlas"), avoidMods: [] },
  variants: [{ kind: "ssf", explanation: text("Fixture ssf") }],
  faq: [{ question: text("Fixture q"), answer: text("Fixture a") }],
};
