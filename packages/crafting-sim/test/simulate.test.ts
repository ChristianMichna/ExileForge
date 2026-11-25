import { describe, expect, it } from "vitest";
import { CraftSimRequest } from "@exileforge/contracts";
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

describe("simulate", () => {
  it("matches the closed-form chance of a weighted draw and is reproducible", () => {
    const first = simulate(request(), { catalog: catalog(), config });
    const second = simulate(request(), { catalog: catalog(), config });
    expect(second).toEqual(first);
    if (first.successChance.status !== "ok") throw new Error("expected ok");
    expect(first.successChance.value).toBeGreaterThan(0.23);
    expect(first.successChance.value).toBeLessThan(0.27); // weights 1:3 -> 0.25
    expect(first.successChance.source.kind).toBe("derived");
    const o = first.outcomes;
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
    expect(result.outcomes.blocked).toBe(1000);
    expect(result.outcomes.succeeded).toBe(0);
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
    expect(result.outcomes.succeeded).toBe(0);
    expect(result.outcomes.blocked).toBe(500);
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
    expect(result.outcomes.succeeded).toBe(200);
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
    expect(result.expectedCost.status).toBe("uncalibrated");
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
    for (const r of [wrongLeague, wrongRelease, stale]) expect(r.status).toBe("uncalibrated");
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
