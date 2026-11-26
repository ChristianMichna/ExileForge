import { describe, expect, it } from "vitest";
import { EffectOp, PreconditionOp } from "@astrolabe/crafting-sim";
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
  essence: {
    description: "^Fines it, adding a guaranteed modifier$",
    preconditions: [{ op: "require-rarity", params: { rarities: ["fine"] } }],
    effects: [{ op: "set-rarity", params: { rarity: "grand" } }],
  },
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
    expect(res.summary).toEqual({ currencyActions: 1, essencesWithRarityRule: 1 });
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

  it("leaves higher tiers out", async () => {
    const t = rows("Makes a Plain thing Fine");
    t.TieredCurrency = [
      { BaseItemType: 0, Tier: 2, MinimumModLevel: 35, LowerTierBaseItemType: null },
    ];
    const res = await run(t);
    expect(res.actions).toEqual([]);
    expect(res.findings.map((f) => f.message).join("\n")).toMatch(/higher tier/);
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
    expect(res.findings.map((f) => f.message).join("\n")).toMatch(/1 essences keep no rarity rule/);
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
    for (const rule of [...cfg.currencyActions.essence.preconditions])
      expect(PreconditionOp.safeParse(rule).success).toBe(true);
    for (const rule of cfg.currencyActions.essence.effects)
      expect(EffectOp.safeParse(rule).success).toBe(true);
  });
});
