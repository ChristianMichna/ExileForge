import { describe, expect, it } from "vitest";
import {
  createSimCatalog,
  EffectOp,
  parseCraftSimConfig,
  PreconditionOp,
  simulate,
} from "@astrolabe/crafting-sim";
import { BaseItem, CraftingAction, CraftSimRequest, Mod } from "@astrolabe/contracts";
import { normalizeConfigSchema } from "../src/normalize/catalog.ts";
import { currencyActions, stripMarkup } from "../src/normalize/currency-actions.ts";
import { raritiesFrom } from "../src/normalize/release-facts.ts";
import { cfg } from "./fixtures/raw-catalog.ts";
import { tables, write } from "./fixtures/game-data.ts";

// invented rules and rarities; only the shape follows the real config
const rarities = raritiesFrom(
  {
    affixGenerationTypes: ["Left", "Right"],
    list: [{ name: "Plain" }, { name: "Fine", affixLimit: 2 }, { name: "Grand", affixLimit: 6 }],
  },
  new Set(["Left", "Right"]),
).value;
const addMod = (r: string) => ({
  op: "add-random-mod",
  params: { generationTypes: ["Left", "Right"], domain: "Thing", count: 1, limitsForRarity: r },
});
const config = {
  ...cfg.currencyActions,
  rules: {
    test_action: {
      description: "^Makes a Plain thing Fine$",
      preconditions: [{ op: "require-rarity", params: { rarities: ["plain"] } }],
      effects: [{ op: "set-rarity", params: { rarity: "fine" } }, addMod("fine")],
    },
  },
  essence: [
    {
      description: "^Fines it, adding a guaranteed modifier$",
      preconditions: [{ op: "require-rarity", params: { rarities: ["fine"] } }],
      effects: [{ op: "set-rarity", params: { rarity: "grand" } }],
    },
  ],
};

function rows(description: string) {
  const t = tables();
  t.CurrencyItems = (t.CurrencyItems ?? []).map((r, i) => ({
    ...r,
    Description:
      i === 0 ? description : i === 2 ? "Fines it, adding a [Mod|guaranteed] modifier" : "",
  }));
  return t;
}
const run = async (
  t: ReturnType<typeof rows>,
  over: Partial<Parameters<typeof currencyActions>[0]> = {},
) =>
  currencyActions({
    gameDataDir: await write(t),
    config,
    rarities,
    baseItemIds: new Set(["Test/Orb", "Test/Orb2", "Test/Essence", "Test/Omen", "Test/Core"]),
    modGenerationTypes: new Set(["Left", "Right"]),
    modDomains: new Set(["Thing"]),
    essenceActions: [
      {
        id: "Test/Essence",
        name: "Test Essence",
        kind: "essence",
        preconditions: [],
        effects: [{ op: "add-specific-mod", params: { modByItemClass: { A: "m" } } }],
      },
    ],
    ...over,
  });

describe("stripMarkup", () => {
  it("keeps what the player sees", () => {
    expect(stripMarkup("Upgrades [Thing|a   Normal] item to [Fine]")).toBe(
      "Upgrades a Normal item to Fine",
    );
  });
});

describe("raritiesFrom", () => {
  it("splits the total evenly and uses PoB's names as ids", () => {
    expect(rarities?.rarities).toEqual([
      { id: "plain", name: "Plain" },
      { id: "fine", name: "Fine", maxAffixes: { Left: 1, Right: 1 } },
      { id: "grand", name: "Grand", maxAffixes: { Left: 3, Right: 3 } },
    ]);
  });
  it("leaves the fact out for an uneven split or an unknown generation type", () => {
    const odd = raritiesFrom(
      { affixGenerationTypes: ["Left", "Right"], list: [{ name: "Odd", affixLimit: 3 }] },
      new Set(["Left", "Right"]),
    );
    expect(odd.value).toBeUndefined();
    expect(odd.finding?.message).toMatch(/do not split evenly/);
    const unknown = raritiesFrom(
      { affixGenerationTypes: ["Nope"], list: [{ name: "X" }] },
      new Set(["Left"]),
    );
    expect(unknown.finding?.message).toMatch(/no mod has generation type Nope/);
  });
});

describe("currencyActions", () => {
  it("builds the action with the release's limits and adds the rarity rule to the essence", async () => {
    const res = await run(rows("Makes a [ItemRarity|Plain] thing Fine"));
    expect(res.summary).toEqual({
      currencyActions: 1,
      higherTierActions: 0,
      essencesWithRarityRule: 1,
    });
    expect(res.actions).toEqual([
      {
        id: "Test/Orb",
        name: "Test Orb",
        kind: "currency",
        itemId: "Test/Orb",
        preconditions: [{ op: "require-rarity", params: { rarities: ["plain"] } }],
        effects: [
          { op: "set-rarity", params: { rarity: "fine" } },
          {
            op: "add-random-mod",
            params: {
              generationTypes: ["Left", "Right"],
              domain: "Thing",
              count: 1,
              limits: { Left: 1, Right: 1 },
            },
          },
        ],
      },
    ]);
    const essence = res.essenceActions[0] as {
      preconditions: unknown[];
      effects: { op: string }[];
    };
    expect(essence.preconditions).toEqual([
      { op: "require-rarity", params: { rarities: ["fine"] } },
    ]);
    expect(essence.effects.map((e) => e.op)).toEqual(["set-rarity", "add-specific-mod"]);
  });

  it("leaves a currency out whose description changed, and says so", async () => {
    const res = await run(rows("Does something else"));
    expect(res.actions).toEqual([]);
    expect(res.findings.map((f) => f.message).join("\n")).toMatch(
      /1 currency items left out.*description that does not match.*Test\/Orb/,
    );
  });

  it("gives a higher tier the minimum mod level of its table row", async () => {
    const t = rows("Makes a Plain thing Fine");
    t.TieredCurrency = [
      { BaseItemType: 0, Tier: 2, MinimumModLevel: 35, LowerTierBaseItemType: null },
    ];
    const res = await run(t);
    expect(res.summary.higherTierActions).toBe(1);
    const effects = (
      res.actions[0] as { effects: { op: string; params: Record<string, unknown> }[] }
    ).effects;
    expect(effects.find((e) => e.op === "add-random-mod")?.params.minModLevel).toBe(35);
    expect(effects.find((e) => e.op === "set-rarity")?.params.minModLevel).toBeUndefined();
  });

  it("leaves a higher tier without a minimum mod level out", async () => {
    const t = rows("Makes a Plain thing Fine");
    t.TieredCurrency = [
      { BaseItemType: 0, Tier: 2, MinimumModLevel: null, LowerTierBaseItemType: null },
    ];
    const res = await run(t);
    expect(res.actions).toEqual([]);
    expect(res.findings.map((f) => f.message).join("\n")).toMatch(/higher tier without/);
  });

  it("treats a currency with a lower tier as a higher tier, and reports unused rules and keys without a rule", async () => {
    const t = rows("Makes a Plain thing Fine");
    t.TieredCurrency = [
      { BaseItemType: 0, Tier: 1, MinimumModLevel: null, LowerTierBaseItemType: 3 },
    ];
    t.CurrencyItems = (t.CurrencyItems ?? []).map((r, i) =>
      i === 1 ? { ...r, Action: "other_action" } : r,
    );
    const res = await run(t);
    expect(res.actions).toEqual([]);
    const text = res.findings.map((f) => f.message).join("\n");
    expect(text).toMatch(/higher tier without/);
    expect(text).toMatch(/currency actions have no rule.*other_action/);
    const none = await run(rows("Makes a Plain thing Fine"), {
      config: { ...config, rules: { ...config.rules, never_used: config.rules.test_action } },
    });
    expect(none.findings.map((f) => f.message).join("\n")).toMatch(
      /no CurrencyItems row has this Action/,
    );
  });

  it("rejects a description pattern that is invalid or not anchored", () => {
    const bad = (description: string) =>
      normalizeConfigSchema.safeParse({
        ...JSON.parse(JSON.stringify(cfg)),
        currencyActions: {
          ...cfg.currencyActions,
          essence: [{ ...cfg.currencyActions.essence[0], description }],
        },
      }).success;
    expect(bad("^fine$")).toBe(true);
    expect(bad("modifier")).toBe(false);
    expect(bad("^(unclosed$")).toBe(false);
  });

  it("drops a rule with an unknown rarity, generation type or domain", async () => {
    const bad = {
      ...config,
      rules: {
        test_action: {
          ...config.rules.test_action,
          preconditions: [{ op: "require-rarity", params: { rarities: ["missing"] } }],
        },
      },
    };
    const res = await run(rows("Makes a Plain thing Fine"), { config: bad });
    expect(res.actions).toEqual([]);
    expect(res.findings.map((f) => f.message).join("\n")).toMatch(/unknown rarity "missing"/);
    const res2 = await run(rows("Makes a Plain thing Fine"), { modDomains: new Set(["Other"]) });
    expect(res2.actions).toEqual([]);
    expect(res2.findings.map((f) => f.message).join("\n")).toMatch(/unknown mod domain "Thing"/);
  });

  it("leaves everything out and says so when the release has no rarities", async () => {
    const res = await run(rows("Makes a Plain thing Fine"), { rarities: undefined });
    expect(res.actions).toEqual([]);
    expect(res.essenceActions).toHaveLength(1);
    expect(res.findings[0]?.message).toMatch(/no rarities/);
  });

  it("keeps an essence unchanged whose description does not match", async () => {
    const t = tables();
    t.CurrencyItems = (t.CurrencyItems ?? []).map((r) => ({ ...r, Description: "x" }));
    const res = await run(t);
    expect(res.summary.essencesWithRarityRule).toBe(0);
    expect((res.essenceActions[0] as { preconditions: unknown[] }).preconditions).toEqual([]);
    expect(res.findings.map((f) => f.message).join("\n")).toMatch(/1 essences keep no rule/);
  });
});

describe("the real config", () => {
  it("only produces rules that crafting-sim's op vocabulary accepts", async () => {
    const real = raritiesFrom(cfg.releaseFacts.rarities, new Set(["Prefix", "Suffix"])).value;
    const keys = Object.keys(cfg.currencyActions.rules);
    const t = tables();
    t.BaseItemTypes = keys.map((k) => ({ Id: `Test/${k}`, Name: k, ItemClass: 0, DropLevel: 1 }));
    t.CurrencyItems = keys.map((k, i) => ({
      BaseItemType: i,
      StackSize: 1,
      CurrencyUseType: 0,
      Action: k,
      Description: (cfg.currencyActions.rules[k]?.description ?? "").replace(/^\^|\$$/g, ""),
    }));
    t.TieredCurrency = [{ BaseItemType: 99, Tier: 1 }];
    const res = await currencyActions({
      gameDataDir: await write(t),
      config: cfg.currencyActions,
      rarities: real,
      baseItemIds: new Set(keys.map((k) => `Test/${k}`)),
      modGenerationTypes: new Set(["Prefix", "Suffix"]),
      modDomains: new Set(["Item"]),
      essenceActions: [],
    });
    expect(res.findings).toEqual([]);
    expect(res.actions).toHaveLength(keys.length);
    for (const a of res.actions as { preconditions: object[]; effects: object[] }[]) {
      for (const p of a.preconditions) expect(PreconditionOp.safeParse(p).success).toBe(true);
      for (const e of a.effects) expect(EffectOp.safeParse(e).success).toBe(true);
    }
    for (const rule of [...cfg.currencyActions.essence.flatMap((v) => v.preconditions)])
      expect(PreconditionOp.safeParse(rule).success).toBe(true);
    for (const rule of cfg.currencyActions.essence.flatMap((v) => v.effects))
      expect(EffectOp.safeParse(rule).success).toBe(true);
  });
});

describe("with the simulator", () => {
  const mods = ["a", "b", "c", "d"].flatMap((n) =>
    ["Prefix", "Suffix"].map((gen) =>
      Mod.parse({
        id: `fx-${gen}-${n}`,
        groups: [`fx-group-${gen}-${n}`],
        generationType: gen,
        domains: ["Item"],
        requiredLevel: 1,
        stats: [],
        spawnWeights: [{ tag: "default", weight: 10 }],
      }),
    ),
  );
  const base = BaseItem.parse({
    id: "fx-base",
    name: "Fixture base",
    itemClass: "FxClass",
    tags: ["default"],
    requirements: {},
    implicitModIds: [],
    properties: {},
  });
  const simConfig = parseCraftSimConfig({
    version: "test",
    defaultRuns: 2000,
    maxRuns: 5000,
    defaultSeed: 3,
    maxStepExecutionsPerAttempt: 50,
    maxPriceBookAgeMinutes: 60,
  });

  async function realActions() {
    const real = raritiesFrom(cfg.releaseFacts.rarities, new Set(["Prefix", "Suffix"])).value;
    const keys = [
      "transmute_to_magic",
      "upgrade_magic_to_rare",
      "add_mod_to_rare",
      "remove_random_mod",
      "convert_to_normal",
      "transmute_to_rare",
    ];
    const t = tables();
    t.BaseItemTypes = keys.map((k) => ({ Id: `Test/${k}`, Name: k, ItemClass: 0, DropLevel: 1 }));
    t.CurrencyItems = keys.map((k, i) => ({
      BaseItemType: i,
      StackSize: 1,
      CurrencyUseType: 0,
      Action: k,
      Description: (cfg.currencyActions.rules[k]?.description ?? "").replace(/^\^|\$$/g, ""),
    }));
    t.TieredCurrency = [{ BaseItemType: 99, Tier: 1 }];
    const res = await currencyActions({
      gameDataDir: await write(t),
      config: cfg.currencyActions,
      rarities: real,
      baseItemIds: new Set(keys.map((k) => `Test/${k}`)),
      modGenerationTypes: new Set(["Prefix", "Suffix"]),
      modDomains: new Set(["Item"]),
      essenceActions: [],
    });
    return res.actions.map((a) => CraftingAction.parse(a));
  }
  const request = (rarity: string, ids: string[]) =>
    CraftSimRequest.parse({
      dataReleaseId: "poe2-0.0.1+r1",
      start: { baseItemId: "fx-base", itemLevel: 50, rarity, modIds: [], flags: [] },
      strategy: {
        steps: ids.map((id, order) => ({
          order,
          actionIds: [`Test/${id}`],
          onFail: { action: "accept" },
        })),
      },
      goal: { clauses: [{ anyOfModIds: mods.map((m) => String(m.id)) }] },
    });

  it("runs transmute, regal and exalted in order and respects the rarity limits", async () => {
    const catalog = createSimCatalog({ baseItems: [base], mods, actions: await realActions() });
    const ok = simulate(
      request("normal", [
        "transmute_to_magic",
        "upgrade_magic_to_rare",
        "add_mod_to_rare",
        "add_mod_to_rare",
      ]),
      { catalog, config: simConfig },
    );
    expect(ok.successChance.status).toBe("ok");
    if (ok.successChance.status === "ok") expect(ok.successChance.value).toBe(1);
    const alch = simulate(request("magic", ["transmute_to_rare"]), { catalog, config: simConfig });
    expect(alch.successChance.status).toBe("ok");
    const alchFull = simulate(
      request("normal", ["transmute_to_rare", "add_mod_to_rare", "add_mod_to_rare"]),
      { catalog, config: simConfig },
    );
    expect(alchFull.outcomes?.blocked).toBe(0); // 4 + 2 mods fit into 3 prefixes and 3 suffixes
    // an exalted orb on a magic item is blocked by its rarity precondition
    const blocked = simulate(request("magic", ["add_mod_to_rare"]), { catalog, config: simConfig });
    expect(blocked.outcomes?.blocked).toBe(blocked.runs);
    // magic items carry one prefix and one suffix at most: a second transmute step cannot fit more
    const full = simulate(request("normal", ["transmute_to_magic", "transmute_to_magic"]), {
      catalog,
      config: simConfig,
    });
    expect(full.outcomes?.blocked).toBe(full.runs);
  });
});
