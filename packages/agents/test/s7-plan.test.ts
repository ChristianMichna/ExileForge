import { describe, expect, it, vi } from "vitest";
import { BuildState, type ItemSpec, type TargetBuild } from "@astrolabe/contracts/build";
import type { PipelineContext } from "../src/pipeline.js";
import type { S7Config } from "../src/stages/s7-gear.js";
import { planJob } from "../src/stages/s7-plan.js";

const s7: S7Config = {
  slots: [{ id: "SlotA" }, { id: "SlotB" }],
  requiredSlots: ["SlotA", "SlotB"],
  tiers: [{ id: "low", label: "Low" }],
  calcProfiles: ["default"],
  objective: { weights: { M: 1 } },
};
const unique: ItemSpec = { kind: "unique", uniqueId: "FixUnique" as never };
const crafted: ItemSpec = {
  kind: "crafted",
  baseItemId: "FixBase" as never,
  rarity: "FixRare" as never,
  mods: [],
  socketables: [],
};
const text = [{ type: "text" as const, text: "Fits" }];
const entry = (slot: string, target: ItemSpec) => ({
  slot,
  priority: "core",
  target,
  acquisition: "trade",
  rationale: [{ reason: text }],
});
const target = {
  candidateKey: "a",
  state: BuildState.parse({
    classId: "FixClassA",
    level: 20,
    tree: { allocated: [] },
    skills: [],
    items: [],
  }),
  calcs: {},
  rationale: [],
} as unknown as TargetBuild;

const marketPrice = {
  status: "ok" as const,
  value: { amount: 4, currencyItemId: "FixCurrency" },
  source: {
    kind: "market" as const,
    provider: "p",
    league: "L",
    fetchedAt: "2026-11-25T10:00:00.000Z",
    confidence: "high" as const,
  },
};

/** A calc where each equipped item adds 10 to M on top of 100. */
function fakeCalc() {
  const results = new Map<string, { stats: Record<string, number> }>();
  let n = 0;
  return {
    engine: "fake" as const,
    calculate: vi.fn((input: { state: BuildState }) => {
      n += 1;
      const calcId = `calc-${n}`;
      results.set(calcId, { stats: { M: 100 + 10 * input.state.items.length } });
      return Promise.resolve({ default: { status: "ok", calcId } });
    }),
    getResult: (id: string) => {
      const r = results.get(id);
      return Promise.resolve(
        r === undefined
          ? undefined
          : {
              calcId: id,
              pobVersion: "0.23.1",
              dataReleaseId: "poe2-1.0.0+r1",
              calcProfile: "default",
              stats: r.stats,
            },
      );
    },
  };
}

const run = async (opts: { economy?: unknown; choice?: unknown[] } = {}) => {
  const stored = { slots: opts.choice ?? [entry("SlotA", unique), entry("SlotB", crafted)] };
  const ctx = {
    run: { request: { dataReleaseId: "poe2-1.0.0+r1" } },
    calc: fakeCalc(),
    economy: opts.economy,
    result: () => stored,
  } as never as PipelineContext;
  const step = planJob(ctx, s7, s7.tiers, {} as never, target);
  if (step.kind !== "job") throw new Error("expected a job");
  return (await step.run(ctx)) as {
    tiers: {
      slots: { slot: string; cost: { status: string; reason?: string } }[];
      upgradeOrder: { slot: string; gainPerCost: { status: string; value?: number } }[];
    }[];
  };
};

describe("S7 plan job", () => {
  it("prices unique items from the market and ranks them by measured gain per cost", async () => {
    const economy = {
      price: vi.fn(() =>
        Promise.resolve({
          league: "L",
          prices: [{ item: { kind: "uniqueItem", id: "FixUnique" }, price: marketPrice }],
        }),
      ),
    };
    const plan = await run({ economy });
    const tier = plan.tiers[0];
    expect(economy.price).toHaveBeenCalledOnce();
    expect(tier?.slots.map((s) => [s.slot, s.cost.status])).toEqual([
      ["SlotA", "ok"],
      ["SlotB", "uncalibrated"],
    ]);
    // Removing the unique drops M from 120 to 110: gain 10/120 per price 4.
    expect(tier?.upgradeOrder[0]).toMatchObject({ slot: "SlotA", gainPerCost: { status: "ok" } });
    expect(tier?.upgradeOrder[0]?.gainPerCost.value).toBeCloseTo(10 / 120 / 4, 6);
    expect(tier?.upgradeOrder[1]).toMatchObject({
      slot: "SlotB",
      gainPerCost: { status: "uncalibrated" },
    });
  });

  it("marks every price uncalibrated without an economy service, never zero", async () => {
    const plan = await run({ choice: [entry("SlotA", unique), entry("SlotB", unique)] });
    const costs = plan.tiers[0]?.slots.map((s) => s.cost.status);
    expect(costs).toEqual(["uncalibrated", "uncalibrated"]);
    expect(plan.tiers[0]?.upgradeOrder.every((u) => u.gainPerCost.status === "uncalibrated")).toBe(
      true,
    );
  });

  it("reports a failed price fetch as failed, not as a price", async () => {
    const economy = { price: () => Promise.reject(new Error("offline")) };
    const plan = await run({ economy });
    expect(plan.tiers[0]?.slots[0]?.cost).toMatchObject({
      status: "failed",
      error: { code: "price_fetch_failed" },
    });
  });
});
