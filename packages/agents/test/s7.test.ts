import { describe, expect, it } from "vitest";
import { BuildState, type ItemSpec } from "@astrolabe/contracts/build";
import { StageConfig } from "../src/config.js";
import type { PipelineContext } from "../src/pipeline.js";
import { createForgePipeline } from "../src/pipeline-forge.js";
import { geared, gearKey, gearTask, itemEntities, tiersOf } from "../src/stages/s7-gear.js";

const s7: NonNullable<StageConfig["s7"]> = {
  slots: ["SlotA", "SlotB"],
  tiers: [
    { id: "low", label: "Low" },
    { id: "mid", label: "Mid" },
    { id: "high", label: "High" },
  ],
  calcProfiles: ["default"],
};
const unique: ItemSpec = { kind: "unique", uniqueId: "FixUnique" as never };
const crafted: ItemSpec = {
  kind: "crafted",
  baseItemId: "FixBase" as never,
  rarity: "FixRare" as never,
  mods: [{ modId: "FixMod" as never, rollFraction: 0.5, required: true }],
  socketables: [{ kind: "craftingAction", id: "FixAction" as never }],
};
const text = (t: string) => [{ type: "text" as const, text: t }];
const choice = (slot: string, target: ItemSpec) => ({
  slot,
  priority: "core" as const,
  target,
  acquisition: "trade" as const,
  rationale: [{ reason: text("Fits") }],
});

describe("s7 config", () => {
  it("rejects duplicate tier ids", () => {
    const tiers = [
      { id: "a", label: "A" },
      { id: "a", label: "B" },
    ];
    expect(StageConfig.shape.s7.safeParse({ ...s7, tiers }).success).toBe(false);
    expect(StageConfig.shape.s7.safeParse(s7).success).toBe(true);
  });
});

describe("S7 gear", () => {
  it("plans the tiers from the leveling to the endgame tier, in config order", () => {
    expect(tiersOf(s7, { leveling: "low", endgame: "mid" })?.map((t) => t.id)).toEqual([
      "low",
      "mid",
    ]);
    expect(tiersOf(s7, { leveling: "mid", endgame: "high" })?.map((t) => t.id)).toEqual([
      "mid",
      "high",
    ]);
    expect(tiersOf(s7, { leveling: "mid", endgame: "low" })).toBeUndefined();
    expect(tiersOf(s7, { leveling: "low", endgame: "nope" })).toBeUndefined();
    expect(gearKey("mid")).toBe("S7.gear-mid");
  });

  it("lists every catalog entity of an item spec", () => {
    expect(itemEntities(unique)).toEqual([
      { path: "/uniqueId", ref: { kind: "uniqueItem", id: "FixUnique" } },
    ]);
    expect(itemEntities(crafted).map((e) => [e.path, e.ref.kind])).toEqual([
      ["/baseItemId", "baseItem"],
      ["/mods/0/modId", "mod"],
      ["/socketables/0/id", "craftingAction"],
    ]);
  });

  it("puts the chosen items on the target build", () => {
    const state = BuildState.parse({
      classId: "FixClassA",
      level: 20,
      tree: { allocated: [] },
      skills: [],
      items: [],
    });
    const out = geared(state, { slots: [choice("SlotA", unique)] });
    expect(out.items).toEqual([{ slot: "SlotA", item: unique }]);
    expect(out.level).toBe(20);
  });

  describe("check", () => {
    const make = () =>
      gearTask(
        {
          run: { request: {}, interventions: [] },
          result: () => undefined,
          latest: () => undefined,
        } as never as PipelineContext,
        { promptVersion: "t" } as StageConfig,
        s7,
        { id: "low", label: "Low" },
        {} as never,
        { state: { items: [] } } as never,
        [],
      );
    const checkCtx = (over: { ssf?: boolean; calc?: unknown; known?: boolean } = {}) =>
      ({
        run: {
          request: { exclusions: [], mode: { ssf: over.ssf ?? false, hardcore: false } },
          interventions: [],
        },
        catalog: { get: () => (over.known === false ? undefined : {}) },
        calc: over.calc ?? {
          calculate: () => Promise.resolve({ default: { status: "ok", calcId: "calc-1" } }),
        },
      }) as never;
    const full = { slots: [choice("SlotA", unique), choice("SlotB", unique)] };

    it("accepts a complete gear set and calculates it with the configured profiles", async () => {
      const calculate = (input: { profiles: string[]; state: { items: unknown[] } }) => {
        expect(input.profiles).toEqual(["default"]);
        expect(input.state.items).toHaveLength(2);
        return Promise.resolve({ default: { status: "ok", calcId: "calc-1" } });
      };
      expect(await make().check?.(full, checkCtx({ calc: { calculate } }))).toEqual([]);
    });

    it("rejects unknown, duplicate and missing slots before any calculation", async () => {
      const bad = {
        slots: [choice("SlotA", unique), choice("SlotA", unique), choice("Zzz", unique)],
      };
      const findings = await make().check?.(
        bad,
        checkCtx({ calc: { calculate: () => Promise.reject(new Error("no")) } }),
      );
      expect(findings?.map((f) => f.code)).toEqual([
        "unknown_or_duplicate_slot",
        "unknown_or_duplicate_slot",
        "missing_slot",
      ]);
    });

    it("rejects trade items in solo self-found mode", async () => {
      const findings = await make().check?.(full, checkCtx({ ssf: true }));
      expect(findings?.map((f) => f.code)).toEqual(["trade_in_ssf", "trade_in_ssf"]);
    });

    it("reports a failed or missing calculation", async () => {
      const failed = {
        calculate: () =>
          Promise.resolve({ default: { status: "failed", error: { code: "x", message: "boom" } } }),
      };
      expect((await make().check?.(full, checkCtx({ calc: failed })))?.map((f) => f.code)).toEqual([
        "calc_failed",
      ]);
      const empty = { calculate: () => Promise.resolve({}) };
      expect((await make().check?.(full, checkCtx({ calc: empty })))?.map((f) => f.code)).toEqual([
        "calc_missing",
      ]);
    });
  });
});

describe("S7 request check", () => {
  it("stops at the start when the budget tiers are not a configured ascending range", () => {
    const config = { s7 } as StageConfig;
    const plan = (budget: { leveling: string; endgame: string }) =>
      createForgePipeline(config).plan({
        run: { request: { budget }, interventions: [] },
        result: () => undefined,
        latest: () => undefined,
      } as never as PipelineContext);
    expect(plan({ leveling: "mid", endgame: "low" })).toMatchObject({
      kind: "blocked",
      error: { code: "unknown_budget_tier" },
    });
  });
});
