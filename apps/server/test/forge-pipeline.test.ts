import { describe, expect, it, vi } from "vitest";
import {
  createForgePipeline,
  type Pipeline,
  type SkeletonPort,
  type StageConfig,
} from "@astrolabe/agents";
import { BuildRequest, BuildState } from "@astrolabe/contracts/build";
import type { DataRelease } from "@astrolabe/contracts/catalog";
import type { ForgeStep } from "@astrolabe/contracts/forge";
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
  s3: {
    level: 10,
    passivePoints: 3,
    gemLevel: 1,
    supportCount: 1,
    calcProfiles: ["default"],
    objective: { weights: { FakeMetric: 1 }, floors: {} },
  },
};

function setup(pipeline: Pipeline, skeleton?: SkeletonPort, release?: DataRelease) {
  return new ForgeEngine({
    ...(skeleton === undefined ? {} : { skeleton }),
    store: new RunStore(":memory:"),
    catalog: release === undefined ? fixtureCatalog() : fixtureCatalog(release),
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

  /** Drives a preset-skill run through S1 and S2 and returns the step after the last candidate. */
  async function driveToS3(engine: ForgeEngine): Promise<{ runId: string; next: ForgeStep }> {
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
    return { runId, next: second.next };
  }

  it("runs S1 and S2 with a preset skill, checks them, and stops at S3 without the PoB engine", async () => {
    const engine = setup(createForgePipeline(STAGES));
    const { next } = await driveToS3(engine);
    expect(next).toMatchObject({ kind: "failed", error: { code: "skeleton_unavailable" } });
  });

  it("measures all candidates in a background job when a skeleton engine exists", async () => {
    const seen: string[] = [];
    const skeleton = {
      evaluate: (input: { candidate: { key: string } }) => {
        seen.push(input.candidate.key);
        return Promise.resolve({
          candidateKey: input.candidate.key,
          skeleton: BuildState.parse({
            classId: "FixClassA",
            level: 10,
            tree: { allocated: [] },
            skills: [],
            items: [],
          }),
          calcs: {},
        });
      },
    };
    const engine = setup(createForgePipeline(STAGES), skeleton);
    const { runId, next } = await driveToS3(engine);
    expect(next.kind).toBe("wait_user");
    await vi.waitFor(async () => {
      const step = await engine.next(runId);
      expect(step.kind).toBe("wait_user");
      expect(JSON.stringify(step)).toContain("picks one");
    });
    expect(seen).toEqual(["a", "b"]);
    await engine.intervene(runId, { kind: "chooseVariant", candidateKey: "b" });
    expect(await engine.next(runId)).toMatchObject({
      kind: "failed",
      error: { code: "s5_not_configured" },
    });
    expect((await engine.view(runId)).results["S4.selection"]?.value).toEqual({
      candidateKey: "b",
    });
  });

  describe("S4 choice", () => {
    const evaluation = (key: string) =>
      Promise.resolve({
        candidateKey: key,
        skeleton: BuildState.parse({
          classId: "FixClassA",
          level: 10,
          tree: { allocated: [] },
          skills: [],
          items: [],
        }),
        calcs: {},
      });
    const fastSkeleton = {
      evaluate: (input: { candidate: { key: string } }) => evaluation(input.candidate.key),
    };
    /** Keeps the run open after S4 so interventions can still be tested. */
    const openEnded = (pipeline: Pipeline): Pipeline => ({
      ...pipeline,
      plan: (ctx) => {
        const step = pipeline.plan(ctx);
        return step.kind === "blocked" && step.error.code === "s5_not_configured"
          ? { kind: "wait_user", reason: [{ type: "text", text: "later stages" }] }
          : step;
      },
    });
    const reachChoice = async (skeleton: typeof fastSkeleton) => {
      const engine = setup(openEnded(createForgePipeline(STAGES)), skeleton);
      const { runId } = await driveToS3(engine);
      await vi.waitFor(async () => expect((await engine.next(runId)).kind).toBe("wait_user"));
      await vi.waitFor(async () =>
        expect(JSON.stringify(await engine.next(runId))).toContain("picks one"),
      );
      return { engine, runId };
    };

    it("rejects a variant that is not a candidate", async () => {
      const { engine, runId } = await reachChoice(fastSkeleton);
      await expect(
        engine.intervene(runId, { kind: "chooseVariant", candidateKey: "zzz" }),
      ).rejects.toMatchObject({ code: "invalid_intervention" });
    });

    it("rejects a choice while the candidates are still being measured", async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const slow = {
        evaluate: async (input: { candidate: { key: string } }) => {
          await gate;
          return evaluation(input.candidate.key);
        },
      };
      const engine = setup(createForgePipeline(STAGES), slow);
      const { runId } = await driveToS3(engine);
      await expect(
        engine.intervene(runId, { kind: "chooseVariant", candidateKey: "a" }),
      ).rejects.toMatchObject({ code: "invalid_intervention" });
      release();
    });

    it("rejects a second choice; redoing S4 asks the player again", async () => {
      const { engine, runId } = await reachChoice(fastSkeleton);
      await engine.intervene(runId, { kind: "chooseVariant", candidateKey: "a" });
      expect(JSON.stringify(await engine.next(runId))).toContain("later stages");
      await expect(
        engine.intervene(runId, { kind: "chooseVariant", candidateKey: "b" }),
      ).rejects.toMatchObject({ code: "invalid_intervention" });
      await engine.intervene(runId, { kind: "redoStage", stage: "S4" });
      expect(JSON.stringify(await engine.next(runId))).toContain("picks one");
    });

    it("asks for the gem setup after the choice when S5 is configured", async () => {
      const s5 = {
        calcProfiles: ["default"],
        objective: { weights: { FakeMetric: 1 }, floors: {}, floorsFromMetrics: {} },
      };
      const engine = setup(createForgePipeline({ ...STAGES, s5 }), fastSkeleton, {
        maxCharacterLevel: { value: 20, origin: "pob-code" },
        passivePoints: {
          mainTree: { perLevel: 1, fromLevel: 2, origin: "pob-code" },
          weaponSetByAct: { acts: [{ act: 1, areaLevel: 5, points: 2 }], origin: "pob-code" },
        },
      } as never);
      const { runId } = await driveToS3(engine);
      await vi.waitFor(async () =>
        expect(JSON.stringify(await engine.next(runId))).toContain("picks one"),
      );
      await engine.intervene(runId, { kind: "chooseVariant", candidateKey: "a" });
      expect(task(await engine.next(runId)).type).toBe("S5.gems");
    });

    it("stops visibly when the release has no level and point facts", async () => {
      const s5 = {
        calcProfiles: ["default"],
        objective: { weights: { FakeMetric: 1 }, floors: {}, floorsFromMetrics: {} },
      };
      const engine = setup(createForgePipeline({ ...STAGES, s5 }), fastSkeleton);
      const { runId } = await driveToS3(engine);
      await vi.waitFor(async () =>
        expect(JSON.stringify(await engine.next(runId))).toContain("picks one"),
      );
      await engine.intervene(runId, { kind: "chooseVariant", candidateKey: "a" });
      expect(await engine.next(runId)).toMatchObject({
        kind: "failed",
        error: { code: "release_facts_missing" },
      });
    });

    it("drops the choice when S3 is redone", async () => {
      const { engine, runId } = await reachChoice(fastSkeleton);
      await engine.intervene(runId, { kind: "chooseVariant", candidateKey: "a" });
      expect(JSON.stringify(await engine.next(runId))).toContain("later stages");
      await engine.intervene(runId, { kind: "redoStage", stage: "S3" });
      const results = (await engine.view(runId)).results;
      expect(results["S4.selection"]).toBeUndefined();
      expect(results["S3.evaluations"]).toBeUndefined();
    });
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

  it("calculates every stage's numbers with the player's calc overrides", async () => {
    const seen: unknown[] = [];
    const calc = new CalcFake({ dataReleaseId: RELEASE });
    const original = calc.calculate.bind(calc);
    calc.calculate = (input) => {
      seen.push(input.overrides);
      return original(input);
    };
    const engine = new ForgeEngine({
      store: new RunStore(":memory:"),
      catalog: fixtureCatalog(),
      calc,
      config: CONFIG,
      pipelines: [
        {
          id: "calc-test",
          plan: (ctx) =>
            ctx.result("C.calc") === undefined
              ? {
                  kind: "server",
                  key: "C.calc",
                  type: "S3.evaluate",
                  run: async (runCtx) => {
                    await runCtx.calc.calculate({
                      state: BuildState.parse({
                        classId: "FixClassA",
                        level: 1,
                        tree: { allocated: [] },
                        skills: [],
                        items: [],
                      }),
                      profiles: ["default"],
                    });
                    return {};
                  },
                }
              : { kind: "done" },
        },
      ],
      calcProfiles: ["default"],
    });
    const request = BuildRequest.parse({ ...REQUEST, calcOverrides: { enemyIsBoss: "Uber" } });
    const { sessionCode } = await engine.createRun(request, "calc-test");
    await engine.attach(sessionCode);
    expect(seen).toEqual([{ enemyIsBoss: "Uber" }]);
  });

  describe("background jobs", () => {
    const jobPipeline = (run: () => Promise<unknown>): Pipeline => ({
      id: "job",
      plan: (ctx) =>
        ctx.result("J.calc") === undefined
          ? {
              kind: "job",
              key: "J.calc",
              type: "S3.evaluate",
              label: "calculating",
              run: async () => (await run()) as never,
            }
          : { kind: "done" },
    });

    it("answers wait while the job runs, starts it once, and continues when it ends", async () => {
      let release: (v: unknown) => void = () => undefined;
      const run = vi.fn(() => new Promise((resolve) => (release = resolve)));
      const engine = setup(jobPipeline(run));
      const { runId, sessionCode } = await engine.createRun(REQUEST, "job");
      const first = (await engine.attach(sessionCode)).next;
      expect(first).toMatchObject({ kind: "wait_user" });
      expect((await engine.next(runId)).kind).toBe("wait_user");
      expect(run).toHaveBeenCalledTimes(1);

      release({ ok: true });
      await vi.waitFor(async () => expect((await engine.next(runId)).kind).toBe("done"));
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("fails the run with the job's error", async () => {
      const engine = setup(jobPipeline(() => Promise.reject(new Error("pob down"))));
      const { runId, sessionCode } = await engine.createRun(REQUEST, "job");
      await engine.attach(sessionCode);
      await vi.waitFor(async () =>
        expect(await engine.next(runId)).toMatchObject({
          kind: "failed",
          error: { code: "job_failed", message: expect.stringContaining("pob down") },
        }),
      );
    });

    it("fails the run when a job hangs longer than the configured limit", async () => {
      vi.useFakeTimers();
      try {
        const engine = setup(jobPipeline(() => new Promise(() => undefined)));
        const { runId, sessionCode } = await engine.createRun(REQUEST, "job");
        await engine.attach(sessionCode);
        await vi.advanceTimersByTimeAsync(CONFIG.jobTimeoutMinutes * 60_000 + 1000);
        expect(await engine.next(runId)).toMatchObject({
          kind: "failed",
          error: { code: "job_failed", message: expect.stringContaining("did not finish within") },
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("runs a failed job again when the player resumes the run", async () => {
      let calls = 0;
      const run = vi.fn(() =>
        ++calls === 1 ? Promise.reject(new Error("pob down")) : Promise.resolve({}),
      );
      const engine = setup(jobPipeline(run));
      const { runId, sessionCode } = await engine.createRun(REQUEST, "job");
      await engine.attach(sessionCode);
      await vi.waitFor(async () => expect((await engine.next(runId)).kind).toBe("failed"));
      await engine.intervene(runId, { kind: "resume" });
      await vi.waitFor(async () => expect((await engine.next(runId)).kind).toBe("done"));
      expect(run).toHaveBeenCalledTimes(2);
    });

    it("does not store the failure a closing pool causes, and restarts the job later", async () => {
      let fail: (e: Error) => void = () => undefined;
      let calls = 0;
      const run = vi.fn(() =>
        ++calls === 1 ? new Promise((_, reject) => (fail = reject)) : Promise.resolve({}),
      );
      const engine = setup(jobPipeline(run));
      const { runId, sessionCode } = await engine.createRun(REQUEST, "job");
      await engine.attach(sessionCode);
      engine.stopJobs();
      fail(new Error("pool closed"));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect((await engine.view(runId)).phase).not.toBe("failed");
      await vi.waitFor(async () => expect((await engine.next(runId)).kind).toBe("done"));
      expect(run).toHaveBeenCalledTimes(2);
    });

    it("drops the answer of a job whose stage was redone meanwhile", async () => {
      let release: (v: unknown) => void = () => undefined;
      const run = vi.fn(() => new Promise((resolve) => (release = resolve)));
      const engine = setup(jobPipeline(run));
      const { runId, sessionCode } = await engine.createRun(REQUEST, "job");
      await engine.attach(sessionCode);
      await engine.intervene(runId, { kind: "redoStage", stage: "S3" });
      release({ stale: true });
      await new Promise((resolve) => setTimeout(resolve, 20));
      // The stale result is gone, so the next step starts the job again.
      expect((await engine.next(runId)).kind).toBe("wait_user");
      expect(run).toHaveBeenCalledTimes(2);
    });
  });
});
