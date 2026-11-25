import { describe, expect, it } from "vitest";
import { createForgePipeline, type Pipeline, type StageConfig } from "@exileforge/agents";
import { BuildRequest } from "@exileforge/contracts/build";
import type { ForgeStep } from "@exileforge/contracts/forge";
import { CalcFake } from "../src/calc/calc-fake.js";
import { ForgeEngine } from "../src/engine/forge-engine.js";
import { RunStore } from "../src/store/run-store.js";
import { CONFIG, REQUEST, RELEASE, candidate, fixtureCatalog } from "./fixtures.js";

const STAGES: StageConfig = {
  version: "test",
  promptVersion: "test",
  supportGemKinds: ["fixture_support"],
  s1: { maxListItems: 5 },
  s2: { candidateCount: 2, maxKeyEntities: 5 },
};

function setup(pipeline: Pipeline) {
  return new ForgeEngine({
    store: new RunStore(":memory:"),
    catalog: fixtureCatalog(),
    calc: new CalcFake({ dataReleaseId: RELEASE }),
    config: CONFIG,
    pipelines: [pipeline],
    calcProfiles: ["default"],
  });
}

function task(step: ForgeStep) {
  if (step.kind !== "task") throw new Error(`expected task, got ${JSON.stringify(step)}`);
  return step.task;
}

describe("forge pipeline (agents)", () => {
  const withoutSkill = BuildRequest.parse({ ...REQUEST, mainSkillId: undefined });

  it("starts with S0 when no main skill is chosen and rejects invented skills", async () => {
    const engine = setup(createForgePipeline(STAGES));
    const { runId, sessionCode } = await engine.createRun(withoutSkill, "forge");
    const t = task((await engine.attach(sessionCode)).next);
    expect(t.type).toBe("S0.skill");

    const rejected = await engine.submit({
      runId,
      taskId: t.taskId,
      attempt: 1,
      payload: {
        mainSkillId: "MadeUpGem",
        rationale: [{ reason: [{ type: "text", text: "Fits the idea." }] }],
      },
    });
    expect(rejected.result).toBe("rejected");
    if (rejected.result !== "rejected") throw new Error();
    expect(rejected.findings.some((f) => f.gate === "G1")).toBe(true);
  });

  it("goes from S0 to the S1 profile task after an accepted skill", async () => {
    const engine = setup(createForgePipeline(STAGES));
    const { runId, sessionCode } = await engine.createRun(withoutSkill, "forge");
    const t = task((await engine.attach(sessionCode)).next);
    const accepted = await engine.submit({
      runId,
      taskId: t.taskId,
      attempt: 1,
      payload: {
        mainSkillId: "FixGemMain",
        rationale: [{ reason: [{ type: "text", text: "Fits the idea." }] }],
      },
    });
    expect(accepted.result).toBe("accepted");
    if (accepted.result !== "accepted") throw new Error();
    expect(task(accepted.next).type).toBe("S1.profile");
  });

  it("fails the run with the stage error when the plan is blocked", async () => {
    const engine = setup({
      id: "blocked",
      plan: () => ({ kind: "blocked", error: { code: "stage_not_implemented", message: "later" } }),
    });
    const { sessionCode } = await engine.createRun(REQUEST, "blocked");
    const step = (await engine.attach(sessionCode)).next;
    expect(step).toMatchObject({ kind: "failed", error: { code: "stage_not_implemented" } });
  });

  const profile = (extra: Record<string, unknown> = {}) => ({
    scalingStats: [],
    supportCandidates: [],
    relevantUniques: [],
    relevantNodes: [],
    ascendancyCandidates: [],
    ...extra,
  });

  it("runs S1 and S2 with a preset skill, checks them, and ends with stage_not_implemented", async () => {
    const engine = setup(createForgePipeline(STAGES));
    const { runId, sessionCode } = await engine.createRun(REQUEST, "forge");
    let t = task((await engine.attach(sessionCode)).next);
    expect(t.type).toBe("S1.profile");

    const bad = await engine.submit({
      runId,
      taskId: t.taskId,
      attempt: 1,
      payload: profile({ scalingStats: ["made.up.stat"] }),
    });
    expect(bad.result).toBe("rejected");
    if (bad.result !== "rejected") throw new Error();
    expect(bad.findings.map((f) => f.code)).toContain("unknown_stat");

    const tooLong = await engine.submit({
      runId,
      taskId: task(bad.next).taskId,
      attempt: 2,
      payload: profile({ relevantNodes: Array.from({ length: 6 }, (_, i) => `n${i}`) }),
    });
    expect(tooLong.result).toBe("rejected");

    const ok = await engine.submit({
      runId,
      taskId: task((tooLong as { next: ForgeStep }).next).taskId,
      attempt: 3,
      payload: profile(),
    });
    expect(ok.result).toBe("accepted");
    if (ok.result !== "accepted") throw new Error();
    t = task(ok.next);
    expect(t.type).toBe("S2.candidate");

    const first = await engine.submit({
      runId,
      taskId: t.taskId,
      attempt: 1,
      payload: candidate("a", "FixClassA", "FixAscA1"),
    });
    expect(first.result).toBe("accepted");
    if (first.result !== "accepted") throw new Error();

    const same = await engine.submit({
      runId,
      taskId: task(first.next).taskId,
      attempt: 1,
      payload: candidate("a", "FixClassA", "FixAscA1"),
    });
    expect(same.result).toBe("rejected");
    if (same.result !== "rejected") throw new Error();
    const codes = same.findings.map((f) => f.code);
    expect(codes).toContain("duplicate_key");
    expect(codes).toContain("not_distinct");

    const mismatch = await engine.submit({
      runId,
      taskId: task(same.next).taskId,
      attempt: 2,
      payload: candidate("b", "FixClassB", "FixAscA1"),
    });
    expect(mismatch.result).toBe("rejected");
    if (mismatch.result !== "rejected") throw new Error();
    expect(mismatch.findings.map((f) => f.code)).toContain("ascendancy_class_mismatch");

    const second = await engine.submit({
      runId,
      taskId: task(mismatch.next).taskId,
      attempt: 3,
      payload: candidate("b", "FixClassB", "FixAscB1"),
    });
    expect(second.result).toBe("accepted");
    if (second.result !== "accepted") throw new Error();
    expect(second.next).toMatchObject({ kind: "failed", error: { code: "stage_not_implemented" } });
  });

  it("rejects a support gem and an excluded gem as main skill in S0", async () => {
    const engine = setup(createForgePipeline({ ...STAGES, supportGemKinds: ["fixture_kind"] }));
    const { runId, sessionCode } = await engine.createRun(withoutSkill, "forge");
    const t = task((await engine.attach(sessionCode)).next);
    const out = await engine.submit({
      runId,
      taskId: t.taskId,
      attempt: 1,
      payload: {
        mainSkillId: "FixGemMain",
        rationale: [{ reason: [{ type: "text", text: "Fits." }] }],
      },
    });
    expect(out.result).toBe("rejected");
    if (out.result !== "rejected") throw new Error();
    expect(out.findings.map((f) => f.code)).toContain("support_as_main_skill");
  });

  it("stops with a clear error when a preset main skill is a support gem", async () => {
    const engine = setup(createForgePipeline({ ...STAGES, supportGemKinds: ["fixture_kind"] }));
    const { sessionCode } = await engine.createRun(REQUEST, "forge");
    const step = (await engine.attach(sessionCode)).next;
    expect(step).toMatchObject({ kind: "failed", error: { code: "invalid_main_skill" } });
  });
});
