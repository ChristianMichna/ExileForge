import { describe, expect, it } from "vitest";
import { BuildState, type RichText } from "@astrolabe/contracts/build";
import type { StageConfig } from "../src/config.js";
import type { PipelineContext } from "../src/pipeline.js";
import type { ProgressionStageTree } from "../src/ports.js";
import { notesTask, planStep, stagesJob } from "../src/stages/s6-progression.js";

const s6: NonNullable<StageConfig["s6"]> = {
  stages: [
    {
      key: "early",
      label: "Early",
      kind: "campaign",
      act: 1,
      levelRange: [1, 10],
      passivePoints: 1,
    },
    { key: "late", label: "Late", kind: "endgame", levelRange: [11, 20], passivePoints: 2 },
  ],
  calcProfiles: ["default"],
  objective: { weights: { FakeMetric: 1 }, floors: {} },
};
const text = (t: string): RichText => [{ type: "text", text: t }];
const tree = (key: string, nodes: string[]): ProgressionStageTree => ({
  key,
  state: BuildState.parse({
    classId: "FixClassA",
    level: 10,
    tree: { allocated: nodes.map((nodeId) => ({ nodeId })) },
    skills: [],
    items: [],
  }),
  allocationOrder: nodes,
  respecs: [],
  calcs: { default: { status: "ok", calcId: "calc-1" } } as never,
});
const trees = [tree("early", ["a"]), tree("late", ["a", "b"])];
const noProgressionCtx = {
  run: { request: {} },
  result: () => undefined,
} as never as PipelineContext;
const config = { promptVersion: "t" } as StageConfig;

describe("S6 stages", () => {
  it("blocks visibly without the PoB progression service", () => {
    const step = stagesJob(noProgressionCtx, s6, {} as never, {} as never, {} as never);
    expect(step).toMatchObject({ kind: "blocked", error: { code: "progression_unavailable" } });
  });

  it("asks for every stage key exactly once", async () => {
    const spec = notesTask(
      { run: { request: {} }, result: () => undefined, catalog: {} } as never,
      config,
      s6,
      trees,
    );
    const note = (key: string) => ({ key, tasks: [text("Do it")], dangers: [], rationale: [] });
    const bad = await spec.check?.(
      { stages: [note("early"), note("early"), note("zzz")] },
      {} as never,
    );
    expect(bad?.map((f) => f.code).sort()).toEqual([
      "missing_stage",
      "unknown_or_duplicate_stage",
      "unknown_or_duplicate_stage",
    ]);
    const ok = await spec.check?.({ stages: [note("early"), note("late")] }, {} as never);
    expect(ok).toEqual([]);
  });

  it("assembles the plan from the measured stages and the texts", async () => {
    const notes = {
      stages: ["early", "late"].map((key) => ({
        key,
        tasks: [text("Do it")],
        dangers: [],
        rationale: [],
      })),
    };
    const step = planStep(s6, trees, notes);
    if (step.kind !== "server") throw new Error("expected a server step");
    const plan = (await step.run({} as never)) as { stages: { key: string; order: number }[] };
    expect(plan.stages.map((s) => [s.key, s.order])).toEqual([
      ["early", 0],
      ["late", 1],
    ]);
  });
});
