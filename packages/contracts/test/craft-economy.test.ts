import { describe, expect, it } from "vitest";
import {
  CraftSimRequest,
  CraftSimResult,
  CraftStrategy,
  EconomyTools,
  PriceBook,
} from "../src/index.js";

const strategy = {
  steps: [
    { order: 0, actionIds: ["action-a"], onFail: { action: "restart" } },
    { order: 1, actionIds: ["action-b"], onFail: { action: "goto", order: 0 } },
  ],
};

describe("craft strategy", () => {
  it("accepts a strategy whose goto targets exist", () => {
    expect(CraftStrategy.safeParse(strategy).success).toBe(true);
  });

  it("rejects a goto to a missing step and duplicate orders", () => {
    const missing = {
      steps: [strategy.steps[0], { ...strategy.steps[1], onFail: { action: "goto", order: 7 } }],
    };
    expect(CraftStrategy.safeParse(missing).success).toBe(false);
    const dup = { steps: [strategy.steps[0], { ...strategy.steps[1], order: 0 }] };
    expect(CraftStrategy.safeParse(dup).success).toBe(false);
  });
});

describe("craft.simulate request", () => {
  it("needs a goal clause with at least one mod", () => {
    const request = (modIds: string[]) => ({
      dataReleaseId: "poe2-1.0.0+r1",
      start: { baseItemId: "base-x", itemLevel: 80, rarity: "rarity-x", modIds: [] },
      strategy,
      goal: { clauses: [{ anyOfModIds: modIds }] },
    });
    expect(CraftSimRequest.safeParse(request([])).success).toBe(false);
    expect(CraftSimRequest.safeParse(request(["mod-x"])).success).toBe(true);
  });
});

describe("craft.simulate result", () => {
  it("does not allow a PoB source for a chance", () => {
    const result = {
      dataReleaseId: "poe2-1.0.0+r1",
      runs: 10,
      seed: 1,
      successChance: {
        status: "ok",
        value: 0.5,
        source: {
          kind: "pob",
          pobVersion: "v0.23.1",
          dataReleaseId: "poe2-1.0.0+r1",
          calcProfile: "default",
          calcId: "c1",
        },
      },
      successInterval: { status: "uncalibrated", reason: "x" },
      outcomes: { succeeded: 10, finishedWithoutGoal: 0, abandoned: 0, blocked: 0 },
      expectedAttempts: { status: "uncalibrated", reason: "no success" },
      actions: [],
      steps: [],
      expectedCost: { status: "uncalibrated", reason: "no currency" },
    };
    expect(CraftSimResult.safeParse(result).success).toBe(false);
  });
});

describe("economy", () => {
  it("limits economy.price to 200 items", () => {
    const ids = Array.from({ length: 201 }, (_, i) => `item-${i}`);
    expect(
      EconomyTools["economy.price"].input.safeParse({
        items: ids.map((id) => ({ kind: "baseItem", id })),
      }).success,
    ).toBe(false);
  });

  it("keeps unmapped provider ids visible in the price book", () => {
    const parsed = PriceBook.parse({
      provider: "p",
      league: "L",
      dataReleaseId: "poe2-1.0.0+r1",
      fetchedAt: "2026-11-25T00:00:00Z",
      referenceCurrencyItemId: "ref",
      quotes: [],
    });
    expect(parsed.unmappedProviderItemIds).toEqual([]);
  });

  it("rejects duplicate quotes and zero prices", () => {
    const quote = {
      item: { kind: "baseItem", id: "a" },
      providerItemId: "p",
      amount: 1,
      confidence: "high",
    };
    const book = (quotes: unknown[]) => ({
      provider: "p",
      league: "L",
      dataReleaseId: "poe2-1.0.0+r1",
      fetchedAt: "2026-11-25T00:00:00Z",
      referenceCurrencyItemId: "ref",
      quotes,
    });
    expect(PriceBook.safeParse(book([quote, quote])).success).toBe(false);
    expect(PriceBook.safeParse(book([{ ...quote, amount: 0 }])).success).toBe(false);
    expect(PriceBook.safeParse(book([quote])).success).toBe(true);
  });
});
