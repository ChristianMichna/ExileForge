import { describe, expect, it } from "vitest";
import type {
  CraftingPlan,
  GearPlan,
  ProgressionPlan,
  TargetBuild,
} from "@astrolabe/contracts/build";
import type { PipelineContext } from "../src/pipeline.js";
import type { StageConfig } from "../src/config.js";
import { GuideBlock } from "@astrolabe/contracts/guide";
import { depthCheck } from "../src/stages/s9-guide.js";
import {
  craftDetailKey,
  detailItems,
  detailTask,
  slotDetailKey,
  stageDetailKey,
  tierDetailKey,
  withDetails,
} from "../src/stages/s9-detail.js";

const text = (t: string) => [{ type: "text" as const, text: t }];
const skill = (key: string, gem: string, supports: string[] = []) => ({
  key,
  gem: { gemId: gem, level: 1 },
  supports: supports.map((s) => ({ gemId: s, level: 1 })),
});
const stage = (key: string, skills: ReturnType<typeof skill>[]) =>
  ({
    key,
    label: key,
    kind: "campaign",
    levelRange: [1, 5],
    state: { skills },
    calcs: {},
    tasks: [],
    dangers: [],
    rationale: [],
    allocationOrder: [],
    respecs: [],
  }) as never;

const plans = {
  progression: {
    stages: [stage("s-one", [skill("a", "GemA")]), stage("s-two", [skill("a", "GemA", ["SupB"])])],
  } as ProgressionPlan,
  gear: {
    tiers: [
      {
        budgetTier: "starter",
        slots: [{ slot: "Helmet", priority: "core" }],
        upgradeOrder: [],
        calcs: {},
      },
    ],
  } as unknown as GearPlan,
  crafting: [{ key: "S8.craft-starter-helmet", slot: "Helmet" }] as unknown as CraftingPlan[],
};
const config = {
  promptVersion: "t",
  s9: { depth: { minTreeNotesPerStage: 1, minStatPrioritiesPerSlot: 1 } },
} as unknown as StageConfig;
const ctx = (results: Record<string, unknown> = {}) =>
  ({
    run: { request: {}, interventions: [] },
    catalog: {},
    result: (k: string) => results[k],
  }) as never as PipelineContext;
const target = { calcs: {} } as never as TargetBuild;

describe("S9 detail pass", () => {
  it("plans one task per stage, tier, slot and crafting plan with valid task types", () => {
    const items = detailItems(plans);
    expect(items.map((i) => i.key)).toEqual([
      stageDetailKey("s-one"),
      stageDetailKey("s-two"),
      tierDetailKey("starter"),
      slotDetailKey("starter", "Helmet"),
      craftDetailKey("S8.craft-starter-helmet"),
    ]);
    for (const i of items) expect(i.key).toMatch(/^S9\.[a-z][a-z0-9-]*$/);
  });

  it("only lets a stage guide describe gems the stage really has", async () => {
    const item = detailItems(plans).find((i) => i.key === stageDetailKey("s-two"));
    if (item === undefined) throw new Error("stage item missing");
    const spec = detailTask(ctx(), config, item, { plans, target }) as never as {
      check: (p: unknown) => Promise<{ code: string }[]>;
    };
    const guide = (gemChanges: unknown[]) => ({
      intro: text("x"),
      treeNotes: [{ reason: text("y") }],
      gemChanges,
    });
    const gem = (id: string) => ({ kind: "gem", id });
    expect(
      await spec.check(guide([{ action: "add", gem: gem("SupB"), reason: text("r") }])),
    ).toEqual([]);
    expect(
      (await spec.check(guide([{ action: "add", gem: gem("Invented"), reason: text("r") }]))).map(
        (f) => f.code,
      ),
    ).toEqual(["gem_not_in_stage"]);
    expect(
      (await spec.check(guide([{ action: "swap", gem: gem("SupB"), reason: text("r") }]))).map(
        (f) => f.code,
      ),
    ).toEqual(["swap_without_source"]);
    expect(
      (await spec.check({ intro: text("x"), treeNotes: [], gemChanges: [] })).map((f) => f.code),
    ).toEqual(["too_few_tree_notes"]);
  });

  it("merges stored detail prose into the plans, and leaves them alone when the pass is off", () => {
    const results = {
      [stageDetailKey("s-one")]: { intro: text("one") },
      [stageDetailKey("s-two")]: { intro: text("two") },
      [tierDetailKey("starter")]: { description: text("tier") },
      [slotDetailKey("starter", "Helmet")]: { why: text("w"), whereToGet: text("g") },
      [craftDetailKey("S8.craft-starter-helmet")]: { overview: text("o") },
    };
    const merged = withDetails(ctx(results), true, plans);
    expect(merged.progression.stages[1]?.guide?.intro).toEqual(text("two"));
    expect(merged.gear.tiers[0]?.description).toEqual(text("tier"));
    expect(merged.gear.tiers[0]?.slots[0]?.guide?.why).toEqual(text("w"));
    expect(merged.crafting[0]?.guide?.overview).toEqual(text("o"));
    expect(withDetails(ctx(), false, plans)).toBe(plans);
    expect(() => withDetails(ctx({ [stageDetailKey("s-one")]: 5 }), true, plans)).toThrow(
      /unreadable/,
    );
  });

  it("holds sections to the configured depth", () => {
    const depth = { rotationSteps: 2, tips: 1, commonMistakes: 0 } as never;
    const check = depthCheck("playstyle", depth);
    expect(check({ rotationSteps: [1], tips: [] }).map((f) => f.path)).toEqual([
      "/rotationSteps",
      "/tips",
    ]);
    expect(check({ rotationSteps: [1, 2], tips: [1] })).toEqual([]);
  });

  it("keeps digits out of block titles and tells a missing detail from a broken one", () => {
    expect(GuideBlock.safeParse({ title: "Phase 2", detail: text("x") }).success).toBe(false);
    expect(GuideBlock.safeParse({ title: "Warm up", detail: text("x") }).success).toBe(true);
    expect(() => withDetails(ctx(), true, plans)).toThrow(/not been written yet/);
  });
});
