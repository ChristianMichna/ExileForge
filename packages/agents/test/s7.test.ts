import { describe, expect, it } from "vitest";
import { BuildState, type ItemSpec } from "@astrolabe/contracts/build";
import { StageConfig } from "../src/config.js";
import type { PipelineContext } from "../src/pipeline.js";
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
  it("plans every tier up to the requested one, in config order", () => {
    expect(tiersOf(s7, "mid")?.map((t) => t.id)).toEqual(["low", "mid"]);
    expect(tiersOf(s7, "nope")).toBeUndefined();
    expect(gearKey("mid")).toBe("S7.gear-mid");
  });

  it("lists every catalog entity of an item spec", () => {
    expect(itemEntities(unique)).toEqual([{ kind: "uniqueItem", id: "FixUnique" }]);
    expect(itemEntities(crafted).map((e) => e.kind)).toEqual(["baseItem", "mod", "craftingAction"]);
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

  it("rejects unknown and duplicate slots before any calculation", async () => {
    const spec = gearTask(
      {
        run: { request: {}, interventions: [] },
        result: () => undefined,
        latest: () => undefined,
      } as never as PipelineContext,
      { promptVersion: "t" } as StageConfig,
      s7,
      { id: "low", label: "Low" },
      {} as never,
      { state: {} } as never,
    );
    const findings = await spec.check?.(
      { slots: [choice("SlotA", unique), choice("SlotA", unique), choice("Zzz", unique)] },
      {
        run: { request: { exclusions: [] }, interventions: [] },
        catalog: { get: () => ({}) },
        calc: { calculate: () => Promise.reject(new Error("no")) },
      } as never,
    );
    expect(findings?.map((f) => f.code)).toEqual([
      "unknown_or_duplicate_slot",
      "unknown_or_duplicate_slot",
    ]);
  });
});
