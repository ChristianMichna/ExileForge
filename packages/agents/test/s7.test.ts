import { describe, expect, it } from "vitest";
import { BuildState, type ItemSpec } from "@astrolabe/contracts/build";
import { StageConfig } from "../src/config.js";
import type { PipelineContext } from "../src/pipeline.js";
import { createForgePipeline } from "../src/pipeline-forge.js";
import {
  type S7Config,
  geared,
  gearKey,
  gearTask,
  itemEntities,
  resolveS7,
  tiersOf,
} from "../src/stages/s7-gear.js";

const s7: S7Config = {
  slots: [{ id: "SlotA", classes: ["ClassX"], partialBases: ["FixPartial"] }, { id: "SlotB" }],
  requiredSlots: ["SlotA", "SlotB"],
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
    const cfg = { calcProfiles: ["default"], tiers };
    expect(StageConfig.shape.s7.safeParse(cfg).success).toBe(false);
    expect(StageConfig.shape.s7.safeParse({ ...cfg, tiers: tiers.slice(0, 1) }).success).toBe(true);
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

    it("rejects an item whose base class the slot does not accept", async () => {
      const entities = {
        FixBase: { itemClass: "ClassY" },
        FixPartial: { itemClass: "ClassY" },
        FixUnique: { baseItemId: "FixBase" },
      } as Record<string, unknown>;
      const ctx = {
        ...(checkCtx() as object),
        catalog: { get: (r: { id: string }) => ({ entity: entities[r.id] }) },
      } as never;
      const wrong = { slots: [choice("SlotA", unique), choice("SlotB", unique)] };
      const findings = await make().check?.(wrong, ctx);
      expect(findings?.map((f) => f.code)).toEqual(["item_not_allowed_in_slot"]);
      const partial: ItemSpec = { ...(crafted as object), baseItemId: "FixPartial" } as never;
      const ok = { slots: [choice("SlotA", partial), choice("SlotB", unique)] };
      expect(await make().check?.(ok, ctx)).toEqual([]);
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
    const config = {
      s7: { tiers: s7.tiers, calcProfiles: s7.calcProfiles },
    } as unknown as StageConfig;
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

describe("resolveS7", () => {
  const base = { tiers: s7.tiers, calcProfiles: ["default"] };
  const release = (slots: object[]) =>
    ({ id: "poe2-fix+r1", itemSlots: { slots, origin: "pob-data" } }) as never;
  const slot = (id: string, order: number, extra: object = {}) => ({
    id,
    order,
    label: id,
    itemClasses: ["ClassX"],
    ...extra,
  });

  it("uses the release slots in PoB order and requires the non-optional, non-dependent ones", () => {
    const out = resolveS7(
      base,
      release([
        slot("B", 2, { dependsOnSlot: "A" }),
        slot("A", 1),
        slot("C", 3, { optional: true }),
      ]),
    );
    if (typeof out === "string") throw new Error(out);
    expect(out.slots.map((s) => s.id)).toEqual(["A", "B", "C"]);
    expect(out.requiredSlots).toEqual(["A"]);
  });

  it("names a missing slot list or unknown required slot instead of guessing", () => {
    expect(typeof resolveS7(base, undefined)).toBe("string");
    expect(resolveS7({ ...base, requiredSlots: ["Z"] }, release([slot("A", 1)]))).toMatch(/Z/);
  });

  it("lets the config override the slots without class rules", () => {
    const out = resolveS7({ ...base, slots: ["Q"] }, undefined);
    if (typeof out === "string") throw new Error(out);
    expect(out.slots).toEqual([{ id: "Q" }]);
    expect(out.requiredSlots).toEqual(["Q"]);
  });
});
