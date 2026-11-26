import { describe, expect, it } from "vitest";
import { BuildState, type RichText } from "@astrolabe/contracts/build";
import { StageConfig } from "../src/config.js";
import type { PipelineContext } from "../src/pipeline.js";
import type { ProgressionStageTree } from "../src/ports.js";
import { type S6Config, notesTask, planStep, stagesJob } from "../src/stages/s6-progression.js";

const s6: S6Config = {
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
  objective: { weights: { FakeMetric: 1 }, floors: {}, floorsFromMetrics: {} },
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
  unspent: 0,
  calcs: { default: { status: "ok", calcId: "calc-1" } } as never,
});
const trees = [tree("early", ["a"]), tree("late", ["a", "b"])];
const noProgressionCtx = {
  run: { request: {} },
  result: () => undefined,
} as never as PipelineContext;
const config = { promptVersion: "t" } as StageConfig;

describe("s6 config", () => {
  const base = { calcProfiles: ["default"], objective: { weights: { M: 1 } } };
  const stage = (key: string, range: [number, number], points: number) => ({
    key,
    label: key,
    kind: "campaign" as const,
    levelRange: range,
    passivePoints: points,
  });
  const parse = (stages: unknown[]) => StageConfig.shape.s6.safeParse({ ...base, stages }).success;

  it("rejects duplicate keys, reversed or overlapping bands and shrinking points", () => {
    expect(parse([stage("a", [1, 5], 1), stage("b", [6, 9], 2)])).toBe(true);
    expect(parse([stage("a", [1, 5], 1), stage("a", [6, 9], 2)])).toBe(false);
    expect(parse([stage("a", [5, 1], 1)])).toBe(false);
    expect(parse([stage("a", [1, 5], 1), stage("b", [5, 9], 2)])).toBe(false);
    expect(parse([stage("a", [1, 5], 3), stage("b", [6, 9], 2)])).toBe(false);
  });
});

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

  it("fails the plan step when a stage is missing from the stored results", async () => {
    const notes = { stages: [{ key: "early", tasks: [text("x")], dangers: [], rationale: [] }] };
    const step = planStep(s6, trees, notes);
    if (step.kind !== "server") throw new Error("expected a server step");
    expect(() => step.run({} as never)).toThrow(/missing/);
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
