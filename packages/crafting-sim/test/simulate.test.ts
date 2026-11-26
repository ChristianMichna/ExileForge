import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CraftSimRequest, CraftSimResult, Mod as ModSchema } from "@astrolabe/contracts";
import {
  CraftSimInputError,
  createSimCatalog,
  parseCraftSimConfig,
  simulate,
} from "../src/index.js";
import { action, addOne, base, book, mod, RELEASE } from "./fixtures.js";

const config = parseCraftSimConfig({
  version: "test",
  defaultRuns: 40000,
  maxRuns: 100000,
  defaultSeed: 7,
  maxStepExecutionsPerAttempt: 50,
  maxPriceBookAgeMinutes: 60,
});

const catalog = (
  mods = [mod("mod-a", 1), mod("mod-b", 3)],
  extra: ReturnType<typeof action>[] = [],
) =>
  createSimCatalog({
    baseItems: [base],
    mods,
    actions: [
      action("act-add", [addOne()], { itemId: "cur-add" }),
      action("act-reroll", [{ op: "clear-mods", params: {} }, addOne()], { itemId: "cur-add" }),
      ...extra,
    ],
  });

const start = {
  baseItemId: "base-alpha",
  itemLevel: 50,
  rarity: "rarity-x",
  modIds: [] as string[],
  flags: [],
};

function request(over: Partial<Record<string, unknown>> = {}): CraftSimRequest {
  return CraftSimRequest.parse({
    dataReleaseId: RELEASE,
    start,
    strategy: { steps: [{ order: 0, actionIds: ["act-add"], onFail: { action: "accept" } }] },
    goal: { clauses: [{ anyOfModIds: ["mod-a"] }] },
    ...over,
  });
}

const outcomesOf = (r: ReturnType<typeof simulate>) => {
  if (!r.outcomes) throw new Error("expected outcomes");
  return r.outcomes;
};

describe("simulate", () => {
  it("matches the closed-form chance of a weighted draw and is reproducible", () => {
    const first = simulate(request(), { catalog: catalog(), config });
    const second = simulate(request(), { catalog: catalog(), config });
    expect(second).toEqual(first);
    if (first.successChance.status !== "ok") throw new Error("expected ok");
    expect(first.successChance.value).toBeGreaterThan(0.23);
    expect(first.successChance.value).toBeLessThan(0.27); // weights 1:3 -> 0.25
    expect(first.successChance.source.kind).toBe("derived");
    const o = outcomesOf(first);
    expect(o.succeeded + o.finishedWithoutGoal + o.abandoned + o.blocked).toBe(first.runs);
  });

  it("another seed gives another sample", () => {
    const a = simulate(request({ seed: 1 }), { catalog: catalog(), config });
    const b = simulate(request({ seed: 2 }), { catalog: catalog(), config });
    expect(a.seed).toBe(1);
    expect(a.successChance).not.toEqual(b.successChance);
  });

  it("repeat until goal: expected uses until success follow the weights", () => {
    const result = simulate(
      request({
        strategy: {
          steps: [
            {
              order: 0,
              actionIds: ["act-reroll"],
              until: { clauses: [{ anyOfModIds: ["mod-a"] }] },
              onFail: { action: "repeat" },
            },
          ],
        },
        runs: 20000,
      }),
      { catalog: catalog(), config: { ...config, maxStepExecutionsPerAttempt: 1000 } },
    );
    if (result.successChance.status !== "ok") throw new Error("expected ok");
    expect(result.successChance.value).toBe(1);
    const use = result.actions[0]?.perSuccess;
    if (use?.status !== "ok") throw new Error("expected ok");
    expect(use.value).toBeGreaterThan(3.8);
    expect(use.value).toBeLessThan(4.2); // 1 / 0.25
  });

  it("respects the limit of a generation type: a second add is blocked", () => {
    const result = simulate(
      request({
        strategy: {
          steps: [{ order: 0, actionIds: ["act-add", "act-add"], onFail: { action: "accept" } }],
        },
        runs: 1000,
      }),
      { catalog: catalog(), config },
    );
    expect(outcomesOf(result).blocked).toBe(1000);
    expect(outcomesOf(result).succeeded).toBe(0);
    expect(result.expectedAttempts.status).toBe("uncalibrated");
  });

  it("never draws two mods of the same group", () => {
    const mods = [mod("mod-a", 1, { groups: ["g1"] }), mod("mod-b", 1, { groups: ["g1"] })];
    const two = action("act-add2", [addOne(2)], { itemId: "cur-add" });
    const result = simulate(
      request({
        strategy: {
          steps: [{ order: 0, actionIds: ["act-add2", "act-add2"], onFail: { action: "accept" } }],
        },
        goal: { clauses: [{ anyOfModIds: ["mod-a"] }, { anyOfModIds: ["mod-b"] }] },
        runs: 500,
      }),
      { catalog: catalog(mods, [two]), config },
    );
    expect(outcomesOf(result).succeeded).toBe(0);
    expect(outcomesOf(result).blocked).toBe(500);
  });

  it("filters candidates by item level and spawn weight", () => {
    const mods = [
      mod("mod-a", 1, { level: 99 }),
      mod("mod-b", 1),
      mod("mod-c", 5, { tag: "tag-other" }),
    ];
    const result = simulate(
      request({ goal: { clauses: [{ anyOfModIds: ["mod-b"] }] }, runs: 200 }),
      {
        catalog: catalog(mods),
        config,
      },
    );
    expect(outcomesOf(result).succeeded).toBe(200);
  });

  it("is uncalibrated, with the reason, when no mod has a spawn weight", () => {
    const result = simulate(request(), {
      catalog: catalog([mod("mod-a", 0), mod("mod-b", 0)]),
      config,
    });
    expect(result.successChance.status).toBe("uncalibrated");
    if (result.successChance.status === "uncalibrated") {
      expect(result.successChance.reason).toContain("act-add");
    }
  });

  it("is uncalibrated for an op this simulator does not know", () => {
    const odd = action("act-odd", [{ op: "teleport", params: {} }]);
    const result = simulate(
      request({
        strategy: { steps: [{ order: 0, actionIds: ["act-odd"], onFail: { action: "accept" } }] },
      }),
      { catalog: catalog(undefined, [odd]), config },
    );
    expect(result.successChance.status).toBe("uncalibrated");
    if (result.successChance.status === "uncalibrated") {
      expect(result.successChance.reason).toContain("teleport");
    }
  });

  it("reports a strategy that never ends as failed, not as a chance", () => {
    const result = simulate(
      request({
        strategy: {
          steps: [
            {
              order: 0,
              actionIds: ["act-reroll"],
              until: { clauses: [{ anyOfModIds: ["mod-none"] }] },
              onFail: { action: "repeat" },
            },
          ],
        },
        runs: 10,
      }),
      { catalog: catalog([mod("mod-a", 1), mod("mod-b", 3), mod("mod-none", 0)]), config },
    );
    expect(result.successChance.status).toBe("failed");
  });

  it("throws for ids that are not in the release", () => {
    expect(() =>
      simulate(request({ goal: { clauses: [{ anyOfModIds: ["missing"] }] } }), {
        catalog: catalog(),
        config,
      }),
    ).toThrow(CraftSimInputError);
    expect(() =>
      simulate(
        request({
          strategy: { steps: [{ order: 0, actionIds: ["missing"], onFail: { action: "accept" } }] },
        }),
        { catalog: catalog(), config },
      ),
    ).toThrow(CraftSimInputError);
    expect(() => simulate(request({ runs: 1_000_000 }), { catalog: catalog(), config })).toThrow(
      CraftSimInputError,
    );
  });
});

const clock = () => new Date("2026-11-25T00:30:00Z");

describe("cost", () => {
  const startCost = {
    status: "ok",
    value: { amount: 3, currencyItemId: "cur-ref" },
    source: {
      kind: "market",
      provider: "test-provider",
      league: "TestLeague",
      fetchedAt: "2026-11-25T00:00:00Z",
      confidence: "high",
    },
  };

  it("adds start cost and action prices per attempt and divides by successes", () => {
    const result = simulate(request({ costCurrencyItemId: "cur-ref", startCost, runs: 40000 }), {
      catalog: catalog(),
      config,
      prices: book,
      now: clock,
    });
    // per attempt: start 3 + one act-add at 2 = 5; success 0.25 -> 20 reference units
    if (result.expectedCost.status !== "ok") throw new Error(JSON.stringify(result.expectedCost));
    expect(result.expectedCost.value.currencyItemId).toBe("cur-ref");
    expect(result.expectedCost.value.amount).toBeGreaterThan(18.5);
    expect(result.expectedCost.value.amount).toBeLessThan(21.5);
    const source = result.expectedCost.source;
    expect(source.kind).toBe("derived");
    if (source.kind === "derived") {
      expect(source.inputs.some((i) => i.kind === "market")).toBe(true);
      expect(source.inputs.some((i) => i.kind === "gamedata")).toBe(true);
    }
  });

  it("converts into another priced currency", () => {
    const ref = simulate(request({ costCurrencyItemId: "cur-ref", startCost }), {
      catalog: catalog(),
      config,
      prices: book,
      now: clock,
    });
    const big = simulate(request({ costCurrencyItemId: "cur-big", startCost }), {
      catalog: catalog(),
      config,
      prices: book,
      now: clock,
    });
    if (ref.expectedCost.status !== "ok" || big.expectedCost.status !== "ok")
      throw new Error("expected ok");
    expect(big.expectedCost.value.amount).toBeCloseTo(ref.expectedCost.value.amount / 10, 6);
  });

  it("is uncalibrated without start cost, prices or a cost currency, never 0", () => {
    const base = { catalog: catalog(), config, now: clock };
    const noStart = simulate(request({ costCurrencyItemId: "cur-ref" }), {
      ...base,
      prices: book,
      now: clock,
    });
    const noBook = simulate(request({ costCurrencyItemId: "cur-ref", startCost }), base);
    const noCurrency = simulate(request({ startCost }), { ...base, prices: book, now: clock });
    for (const r of [noStart, noBook, noCurrency])
      expect(r.expectedCost.status).toBe("uncalibrated");
  });

  it("names the items without a price", () => {
    const unpriced = { ...book, quotes: [] };
    const result = simulate(request({ costCurrencyItemId: "cur-ref", startCost }), {
      catalog: catalog(),
      config,
      prices: unpriced,
      now: clock,
    });
    expect(result.expectedCost.status).toBe("uncalibrated");
    if (result.expectedCost.status === "uncalibrated") {
      expect(result.expectedCost.reason).toContain("cur-add");
    }
  });

  it("does not use an unusable start cost", () => {
    const failed = { status: "failed", error: { code: "x", message: "y" } };
    const result = simulate(request({ costCurrencyItemId: "cur-ref", startCost: failed }), {
      catalog: catalog(),
      config,
      prices: book,
      now: clock,
    });
    expect(result.expectedCost.status).toBe("failed");
  });

  it("refuses a price book of another league, another release or too old", () => {
    const run = (prices: typeof book, over: Record<string, unknown> = {}) =>
      simulate(request({ costCurrencyItemId: "cur-ref", startCost, ...over }), {
        catalog: catalog(),
        config,
        prices,
        now: clock,
      }).expectedCost;
    const wrongLeague = run(book, { league: "OtherLeague" });
    const wrongRelease = run({
      ...book,
      dataReleaseId: "poe2-9.9.9+r1" as typeof book.dataReleaseId,
    });
    const stale = run({ ...book, fetchedAt: "2026-11-24T00:00:00Z" });
    const future = run({ ...book, fetchedAt: "2099-01-01T00:00:00Z" });
    for (const r of [wrongLeague, wrongRelease, stale, future])
      expect(r.status).toBe("uncalibrated");
    if (stale.status === "uncalibrated") expect(stale.reason).toContain("stale");
    expect(run(book, { league: "TestLeague" }).status).toBe("ok");
  });
});

describe("derived sources", () => {
  it("list the whole mod pool, independent of the seed", () => {
    const inputs = (seed: number) => {
      const r = simulate(request({ seed, runs: 5 }), { catalog: catalog(), config });
      if (r.successChance.status !== "ok" || r.successChance.source.kind !== "derived")
        throw new Error("x");
      return r.successChance.source.inputs;
    };
    const a = inputs(1);
    expect(a).toEqual(inputs(2));
    const mods = a.flatMap((i) =>
      i.kind === "gamedata" && i.entity.kind === "mod" ? [i.entity.id] : [],
    );
    expect(mods).toEqual(["mod-a", "mod-b"]);
  });
});

const step = (order: number, actionIds: string[], extra: Record<string, unknown> = {}) => ({
  order,
  actionIds,
  onFail: { action: "accept" },
  ...extra,
});
const run = (
  over: Record<string, unknown>,
  mods?: ReturnType<typeof mod>[],
  extra: ReturnType<typeof action>[] = [],
) => simulate(request({ runs: 2000, ...over }), { catalog: catalog(mods, extra), config });
const oneMod = [mod("mod-a", 1), mod("mod-c", 1, { gen: "gen-q" })];
describe("ops and preconditions", () => {
  const setRarity = action("act-rarity", [{ op: "set-rarity", params: { rarity: "rarity-y" } }]);
  const needRarity = action("act-needs-rarity", [addOne()], {
    itemId: "cur-add",
    preconditions: [{ op: "require-rarity", params: { rarities: ["rarity-y"] } }],
  });
  const setFlag = action("act-flag", [{ op: "set-flag", params: { flag: "flag-f" } }]);
  const noFlag = action("act-no-flag", [addOne()], {
    itemId: "cur-add",
    preconditions: [{ op: "forbid-flag", params: { flag: "flag-f" } }],
  });
  const emptyOnly = action("act-empty-only", [addOne(2)], {
    itemId: "cur-add",
    preconditions: [{ op: "require-mod-count", params: { max: 0 } }],
  });
  const remove = action("act-remove", [{ op: "remove-random-mod", params: {} }]);
  const clearP = action("act-clear-p", [
    { op: "clear-mods", params: { generationTypes: ["gen-p"] } },
  ]);
  const addTwo = action("act-add-two", [
    {
      op: "add-random-mod",
      params: {
        generationTypes: ["gen-p"],
        limits: { "gen-p": 2 },
        domain: "domain-item",
        count: 2,
      },
    },
  ]);
  const extra = [setRarity, needRarity, setFlag, noFlag, emptyOnly, remove, clearP, addTwo];
  const goalA = { clauses: [{ anyOfModIds: ["mod-a"] }] };
  const only = (mods = [mod("mod-a", 1)]) => mods;

  it("set-rarity satisfies require-rarity, without it the action is blocked", () => {
    const ok = run(
      { strategy: { steps: [step(0, ["act-rarity", "act-needs-rarity"])] }, goal: goalA },
      only(),
      extra,
    );
    expect(outcomesOf(ok).succeeded).toBe(2000);
    const blocked = run(
      { strategy: { steps: [step(0, ["act-needs-rarity"])] }, goal: goalA },
      only(),
      extra,
    );
    expect(outcomesOf(blocked).blocked).toBe(2000);
  });

  it("set-flag makes forbid-flag block", () => {
    const ok = run(
      { strategy: { steps: [step(0, ["act-no-flag", "act-flag"])] }, goal: goalA },
      only(),
      extra,
    );
    expect(outcomesOf(ok).succeeded).toBe(2000);
    const blocked = run(
      { strategy: { steps: [step(0, ["act-flag", "act-no-flag"])] }, goal: goalA },
      only(),
      extra,
    );
    expect(outcomesOf(blocked).blocked).toBe(2000);
  });

  it("require-mod-count max 0 only allows an empty item", () => {
    const twice = run(
      { strategy: { steps: [step(0, ["act-empty-only", "act-empty-only"])] }, goal: goalA },
      only(),
      extra,
    );
    expect(outcomesOf(twice).blocked).toBe(2000);
  });

  it("remove-random-mod removes a mod and is blocked on an empty item", () => {
    const removed = run(
      {
        start: { ...start, modIds: ["mod-a"] },
        strategy: { steps: [step(0, ["act-remove"])] },
        goal: goalA,
      },
      only(),
      extra,
    );
    expect(outcomesOf(removed).finishedWithoutGoal).toBe(2000);
    const empty = run(
      { strategy: { steps: [step(0, ["act-remove"])] }, goal: goalA },
      only(),
      extra,
    );
    expect(outcomesOf(empty).blocked).toBe(2000);
  });

  it("clear-mods with generation types keeps the other types", () => {
    const base = {
      start: { ...start, modIds: ["mod-a", "mod-c"] },
      strategy: { steps: [step(0, ["act-clear-p"])] },
    };
    const keepsQ = run({ ...base, goal: { clauses: [{ anyOfModIds: ["mod-c"] }] } }, oneMod, extra);
    expect(outcomesOf(keepsQ).succeeded).toBe(2000);
    const dropsP = run({ ...base, goal: goalA }, oneMod, extra);
    expect(outcomesOf(dropsP).succeeded).toBe(0);
  });

  it("add-random-mod with count draws that many distinct mods", () => {
    const both = { clauses: [{ anyOfModIds: ["mod-a"] }, { anyOfModIds: ["mod-b"] }] };
    const r = run(
      { strategy: { steps: [step(0, ["act-add-two"])] }, goal: both },
      [mod("mod-a", 1), mod("mod-b", 5)],
      extra,
    );
    expect(outcomesOf(r).succeeded).toBe(2000);
  });

  it("uses the first matching spawn weight: an earlier 0 beats a later positive entry", () => {
    const shadowed = ModSchema.parse({
      id: "mod-x",
      groups: ["group-x"],
      generationType: "gen-p",
      domains: ["domain-item"],
      requiredLevel: 1,
      stats: [],
      spawnWeights: [
        { tag: "tag-alpha", weight: 0 },
        { tag: "tag-any", weight: 100 },
      ],
    });
    const r = run({ goal: { clauses: [{ anyOfModIds: ["mod-x"] }] } }, [mod("mod-a", 1), shadowed]);
    expect(outcomesOf(r).succeeded).toBe(0);
  });
});

describe("onFail", () => {
  const until = { clauses: [{ anyOfModIds: ["mod-a"] }] };
  const twoStep = (onFail: Record<string, unknown>) => ({
    steps: [step(0, ["act-add"], { until, onFail })],
  });

  it("restart and abort end the attempt as abandoned", () => {
    for (const action of ["restart", "abort"]) {
      const onFail =
        action === "abort" ? { action, reason: [{ type: "text", text: "x" }] } : { action };
      const r = run({ strategy: twoStep(onFail), runs: 20000 });
      const o = outcomesOf(r);
      expect(o.abandoned + o.succeeded).toBe(20000);
      expect(o.abandoned / 20000).toBeGreaterThan(0.72);
      expect(o.abandoned / 20000).toBeLessThan(0.78);
    }
  });

  it("goto continues at the named step", () => {
    const r = run({
      strategy: {
        steps: [
          step(0, ["act-reroll"]),
          step(1, ["act-add"], { until, onFail: { action: "goto", order: 0 } }),
        ],
      },
      runs: 5000,
    });
    // act-add on a full item (limit 1) is blocked, so only first-draw successes pass
    const o = outcomesOf(r);
    expect(o.succeeded + o.blocked + o.finishedWithoutGoal + o.abandoned).toBe(5000);
  });

  it("accept ends the attempt without the goal", () => {
    const r = run({ strategy: twoStep({ action: "accept" }), runs: 20000 });
    const o = outcomesOf(r);
    expect(o.finishedWithoutGoal + o.succeeded).toBe(20000);
  });
});

describe("result shape", () => {
  it("matches the contract and has no outcomes when uncalibrated", () => {
    const ok = run({});
    expect(CraftSimResult.safeParse(ok).success).toBe(true);
    const o = outcomesOf(ok);
    expect(o.succeeded + o.finishedWithoutGoal + o.abandoned + o.blocked).toBe(ok.runs);
    const unc = simulate(request(), {
      catalog: catalog([mod("mod-a", 0), mod("mod-b", 0)]),
      config,
    });
    expect(CraftSimResult.safeParse(unc).success).toBe(true);
    expect(unc.outcomes).toBeUndefined();
  });

  it("a blocked action is not counted as used", () => {
    const r = run({ strategy: { steps: [step(0, ["act-add", "act-add"])] }, runs: 100 });
    const use = r.actions[0]?.perAttempt;
    if (use?.status !== "ok") throw new Error("expected ok");
    expect(use.value).toBe(1);
  });

  it("the shipped config/crafting/sim.json is valid", () => {
    const raw = JSON.parse(
      readFileSync(new URL("../../../config/crafting/sim.json", import.meta.url), "utf8"),
    );
    expect(() => parseCraftSimConfig(raw)).not.toThrow();
  });
});

describe("add-specific-mod", () => {
  const fixed = (
    modByItemClass: Record<string, string>,
    limits?: Record<string, number>,
    preconditions: { op: string; params: Record<string, unknown> }[] = [
      { op: "require-rarity", params: { rarities: ["rarity-x"] } },
    ],
  ) =>
    action(
      "act-fixed",
      [{ op: "add-specific-mod", params: { modByItemClass, ...(limits ? { limits } : {}) } }],
      { preconditions },
    );
  const runFixed = (
    act: ReturnType<typeof action>,
    over: { baseClass?: string; modIds?: string[]; mods?: ReturnType<typeof mod>[] } = {},
  ) =>
    simulate(
      request({
        start: { ...start, modIds: over.modIds ?? [] },
        goal: { clauses: [{ anyOfModIds: ["mod-b"] }] },
        strategy: { steps: [{ order: 0, actionIds: ["act-fixed"], onFail: { action: "accept" } }] },
        runs: 1000,
      }),
      {
        catalog: createSimCatalog({
          baseItems: [{ ...base, itemClass: over.baseClass ?? "class-y" }],
          mods: over.mods ?? [mod("mod-a", 1), mod("mod-b", 1)],
          actions: [act],
        }),
        config,
      },
    );

  it("adds the mod of the base item's class, not the first entry", () => {
    const r = runFixed(fixed({ "class-x": "mod-a", "class-y": "mod-b" }));
    expect(outcomesOf(r).succeeded).toBe(1000);
  });

  it("is uncalibrated, with a reason, for a class without an entry", () => {
    const r = runFixed(fixed({ "class-x": "mod-a" }));
    expect(r.successChance.status).toBe("uncalibrated");
    expect(JSON.stringify(r.successChance)).toContain("item class class-y");
    expect(r.outcomes).toBeUndefined();
  });

  it("is uncalibrated without a rarity rule instead of running on any rarity", () => {
    const r = runFixed(fixed({ "class-y": "mod-b" }, undefined, []));
    expect(r.successChance.status).toBe("uncalibrated");
    expect(JSON.stringify(r.successChance)).toContain("require-rarity");
    expect(r.outcomes).toBeUndefined();
  });

  it("is blocked on a rarity the rule does not allow", () => {
    const act = fixed({ "class-y": "mod-b" }, undefined, [
      { op: "require-rarity", params: { rarities: ["rarity-other"] } },
    ]);
    expect(outcomesOf(runFixed(act)).succeeded).toBe(0);
  });

  it("is uncalibrated when the mod is not in the data release", () => {
    const r = runFixed(fixed({ "class-y": "mod-missing" }));
    expect(r.successChance.status).toBe("uncalibrated");
    expect(JSON.stringify(r.successChance)).toContain("mod-missing");
  });

  it("is blocked when a mod of the same group is already on the item", () => {
    const grouped = [mod("mod-a", 1, { groups: ["g"] }), mod("mod-b", 1, { groups: ["g"] })];
    const r = runFixed(fixed({ "class-y": "mod-b" }), { modIds: ["mod-a"], mods: grouped });
    expect(outcomesOf(r).succeeded).toBe(0);
  });

  it("is blocked when the same mod is already on the item", () => {
    const r = runFixed(fixed({ "class-y": "mod-b" }), { modIds: ["mod-b"] });
    expect(outcomesOf(r).blocked).toBe(1000);
  });

  it("is blocked when the generation type has reached the given limit", () => {
    const act = fixed({ "class-y": "mod-b" }, { "gen-p": 1 });
    expect(outcomesOf(runFixed(act, { modIds: ["mod-a"] })).succeeded).toBe(0);
    expect(outcomesOf(runFixed(act)).succeeded).toBe(1000);
  });

  it("names the fields it used as sources, not spawn weights", () => {
    const r = runFixed(fixed({ "class-y": "mod-b" }));
    if (r.successChance.status !== "ok" || r.successChance.source.kind !== "derived") {
      throw new Error("expected a derived chance");
    }
    const fields = r.successChance.source.inputs.flatMap((i) =>
      i.kind === "gamedata" ? [`${i.entity.kind}:${i.entity.id}${i.field}`] : [],
    );
    expect(fields).toContain("baseItem:base-alpha/itemClass");
    expect(fields).toContain("mod:mod-b/groups");
    expect(fields).toContain("mod:mod-b/generationType");
    expect(fields).not.toContain("mod:mod-b/spawnWeights");
  });

  it("minModLevel keeps lower-level mods out of the pool", () => {
    const mods = [mod("low", 1, { level: 10 }), mod("high", 1, { level: 40 })];
    const high = (min?: number) =>
      action("act-high", [
        {
          ...addOne(),
          params: { ...addOne().params, ...(min === undefined ? {} : { minModLevel: min }) },
        },
      ]);
    const run = (min?: number) =>
      simulate(
        request({
          strategy: {
            steps: [{ order: 0, actionIds: ["act-high"], onFail: { action: "accept" } }],
          },
          goal: { clauses: [{ anyOfModIds: ["high"] }] },
        }),
        { catalog: createSimCatalog({ baseItems: [base], mods, actions: [high(min)] }), config },
      );
    const none = run();
    const filtered = run(30);
    if (none.successChance.status !== "ok" || filtered.successChance.status !== "ok")
      throw new Error("expected ok");
    expect(none.successChance.value).toBeGreaterThan(0.45);
    expect(none.successChance.value).toBeLessThan(0.55);
    expect(filtered.successChance.value).toBe(1);
  });

  describe("limits from the release's rarities", () => {
    const byRarity = {
      op: "add-random-mod",
      params: { generationTypes: ["gen-p"], limitsByRarity: true, domain: "domain-item", count: 1 },
    };
    const twoAdds = (rarities?: Parameters<typeof createSimCatalog>[0]["rarities"]) =>
      simulate(
        request({
          strategy: {
            steps: [{ order: 0, actionIds: ["act-rar", "act-rar"], onFail: { action: "accept" } }],
          },
          goal: { clauses: [{ anyOfModIds: ["mod-a", "mod-b"] }] },
        }),
        {
          catalog: createSimCatalog({
            baseItems: [base],
            mods: [mod("mod-a", 1), mod("mod-b", 3)],
            actions: [action("act-rar", [byRarity])],
            rarities,
          }),
          config,
        },
      );

    it("blocks the second mod at the rarity's limit of one", () => {
      const res = twoAdds([{ id: "rarity-x", name: "X", maxAffixes: { "gen-p": 1 } }]);
      expect(res.outcomes?.blocked).toBe(res.runs);
    });

    it("lets the item class's own limit win over the rarity's", () => {
      const res = twoAdds([
        {
          id: "rarity-x",
          name: "X",
          maxAffixes: { "gen-p": 1 },
          maxAffixesByItemClass: { "class-x": { "gen-p": 2 } },
        },
      ]);
      expect(res.outcomes?.blocked).toBe(0);
      expect(res.successChance.status).toBe("ok");
    });

    it("blocks when the item's rarity has no limit for the type, and is uncalibrated without rarities", () => {
      const none = twoAdds([{ id: "rarity-x", name: "X" }]);
      expect(none.outcomes?.blocked).toBe(none.runs);
      const missing = twoAdds(undefined);
      expect(missing.successChance.status).toBe("uncalibrated");
    });
  });
});
