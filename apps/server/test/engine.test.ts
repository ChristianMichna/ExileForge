import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RunEvent } from "@exileforge/contracts/events";
import type { ForgeStep } from "@exileforge/contracts/forge";
import { ForgeTools } from "@exileforge/contracts/forge";
import { CalcFake } from "../src/calc/calc-fake.js";
import { PersistedCalc } from "../src/calc/persisted-calc.js";
import type { ForgeConfig } from "../src/config/forge-config.js";
import { ESCALATION_ABORT, ESCALATION_RETRY, ForgeEngine } from "../src/engine/forge-engine.js";
import { createPocPipeline } from "../src/pipelines/poc-pipeline.js";
import { RunStore } from "../src/store/run-store.js";
import { CONFIG, REQUEST, RELEASE, candidate, fixtureCatalog, gemSetup } from "./fixtures.js";

function setup(
  options: { config?: ForgeConfig; dbPath?: string; calc?: CalcFake; now?: () => Date } = {},
) {
  const config = options.config ?? CONFIG;
  const store = new RunStore(options.dbPath ?? ":memory:");
  const calc = new PersistedCalc(options.calc ?? new CalcFake({ dataReleaseId: RELEASE }), store);
  const engine = new ForgeEngine({
    store,
    catalog: fixtureCatalog(),
    calc,
    config,
    pipelines: [createPocPipeline(config.pipelines.poc)],
    calcProfiles: config.pipelines.poc.calcProfiles,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return { engine, store, calc };
}

function task(step: ForgeStep) {
  if (step.kind !== "task") throw new Error(`expected task, got ${JSON.stringify(step)}`);
  return step.task;
}

const submitOutput = ForgeTools["forge.submit"].output;

describe("forge loop", () => {
  it("runs the PoC pipeline from attach to done with checks, user choice and live events", async () => {
    const { engine } = setup();
    const { runId, sessionCode } = await engine.createRun(REQUEST, "poc");
    const events: RunEvent[] = [];
    engine.subscribe(runId, (e) => events.push(e));

    const attached = await engine.attach(sessionCode);
    expect(ForgeTools["forge.attach"].output.parse(attached)).toBeTruthy();
    let t = task(attached.next);
    expect(t.type).toBe("S2.candidate");
    expect(t.responseSchema).toHaveProperty("type", "object");
    expect(t.allowedTools).toContain("catalog_search");

    // Schema error → rejected with JSON pointer, attempt 2 of the same task.
    let out = await engine.submit({ runId, taskId: t.taskId, attempt: 1, payload: { key: "a" } });
    submitOutput.parse(out);
    expect(out.result).toBe("rejected");
    if (out.result !== "rejected") throw new Error();
    expect(out.findings[0]?.gate).toBe("schema");
    t = task(out.next);
    expect(t.attempt).toBe(2);
    expect(t.findings.length).toBeGreaterThan(0);

    // Invented id → G1.
    out = await engine.submit({
      runId,
      taskId: t.taskId,
      attempt: 2,
      payload: candidate("a", "MadeUpClass", "FixAscA1"),
    });
    if (out.result !== "rejected") throw new Error("expected rejection");
    expect(out.findings).toEqual([
      expect.objectContaining({ gate: "G1", code: "unknown_entity", path: "/classId" }),
    ]);
    t = task(out.next);

    out = await engine.submit({
      runId,
      taskId: t.taskId,
      attempt: 3,
      payload: candidate("a", "FixClassA", "FixAscA1"),
    });
    expect(out.result).toBe("accepted");
    t = task(out.next);
    expect(t.attempt).toBe(1);
    expect(t.context).toMatchObject({ previousCandidates: [{ key: "a" }] });

    // Ascendancy of another class → task check finding.
    out = await engine.submit({
      runId,
      taskId: t.taskId,
      attempt: 1,
      payload: candidate("b", "FixClassB", "FixAscA1"),
    });
    if (out.result !== "rejected") throw new Error("expected rejection");
    expect(out.findings[0]?.code).toBe("ascendancy_class_mismatch");
    t = task(out.next);
    out = await engine.submit({
      runId,
      taskId: t.taskId,
      attempt: 2,
      payload: candidate("b", "FixClassB", "FixAscB1"),
    });

    // S3 runs on the server, then the user must choose (S4).
    expect(out.result).toBe("accepted");
    if (out.result !== "accepted") throw new Error();
    expect(out.next.kind).toBe("wait_user");
    expect((await engine.status(runId)).phase).toBe("waiting_user");
    const view = await engine.view(runId);
    expect(Object.keys(view.results).some((k) => k.startsWith("S3.evaluate"))).toBe(true);

    await expect(
      engine.intervene(runId, { kind: "chooseVariant", candidateKey: "nope" }),
    ).rejects.toMatchObject({ code: "invalid_intervention" });
    await engine.intervene(runId, { kind: "chooseVariant", candidateKey: "b" });

    t = task(await engine.next(runId));
    expect(t.type).toBe("S5.gems");
    expect(t.feedback).toEqual([{ kind: "chooseVariant", candidateKey: "b" }]);

    out = await engine.submit({
      runId,
      taskId: t.taskId,
      attempt: 1,
      payload: gemSetup("FixGemOther"),
    });
    if (out.result !== "rejected") throw new Error("expected rejection");
    expect(out.findings[0]?.code).toBe("main_skill_mismatch");
    t = task(out.next);
    out = await engine.submit({ runId, taskId: t.taskId, attempt: 2, payload: gemSetup() });
    if (out.result !== "accepted") throw new Error("expected acceptance");
    expect(out.next.kind).toBe("done");

    const status = await engine.status(runId);
    expect(status).toMatchObject({ phase: "done", completedTasks: 3, plannedTasks: 3 });

    // Events: contract-valid, strictly increasing seq, calc results reported.
    events.forEach((e) => RunEvent.parse(e));
    const seqs = events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    const types = events.map((e) => e.type);
    expect(types).toContain("task.rejected");
    expect(types).toContain("calc.completed");
    expect(types).toContain("feedback.queued");
    expect(types.at(-1)).toBe("guide.ready");
    expect(engine.eventsAfter(runId, -1).length).toBeGreaterThanOrEqual(events.length);
  });

  it("rejects free numbers in text and unknown calc references", async () => {
    const { engine } = setup();
    const { runId, sessionCode } = await engine.createRun(REQUEST, "poc");
    const t = task((await engine.attach(sessionCode)).next);
    const payload = candidate("a", "FixClassA", "FixAscA1");
    payload["hypothesis"] = [
      { type: "text", text: "deals 300 more" },
      { type: "calc", ref: { calcId: "invented", stat: "x" } },
    ];
    const out = await engine.submit({ runId, taskId: t.taskId, attempt: 1, payload });
    if (out.result !== "rejected") throw new Error("expected rejection");
    expect(out.findings.map((f) => [f.code, f.path])).toEqual([
      ["free_number", "/hypothesis/0"],
      ["unknown_calc_ref", "/hypothesis/1"],
    ]);
  });

  it("escalates to the user after the last failed attempt; retry resets, abort fails the run", async () => {
    const { engine } = setup();
    const { runId, sessionCode } = await engine.createRun(REQUEST, "poc");
    let t = task((await engine.attach(sessionCode)).next);
    let out;
    for (let attempt = 1; attempt <= CONFIG.maxAttemptsPerTask; attempt += 1) {
      out = await engine.submit({ runId, taskId: t.taskId, attempt, payload: {} });
      if (out.next.kind === "task") t = out.next.task;
    }
    expect(out?.next.kind).toBe("wait_user");
    const ask = (await engine.view(runId)).asks[0];
    expect(ask).toMatchObject({
      origin: "escalation",
      options: [ESCALATION_RETRY, ESCALATION_ABORT],
    });
    if (ask === undefined) throw new Error();
    await expect(
      engine.submit({ runId, taskId: t.taskId, attempt: 3, payload: {} }),
    ).rejects.toMatchObject({ code: "stale_task" });

    await engine.intervene(runId, { kind: "answer", askId: ask.askId, answer: ESCALATION_RETRY });
    t = task(await engine.next(runId));
    expect(t.attempt).toBe(1);
    expect(t.findings.length).toBeGreaterThan(0);

    for (let attempt = 1; attempt <= CONFIG.maxAttemptsPerTask; attempt += 1) {
      await engine.submit({ runId, taskId: t.taskId, attempt, payload: {} });
    }
    const second = (await engine.view(runId)).asks.find((a) => a.answer === undefined);
    if (second === undefined) throw new Error("expected second escalation");
    await engine.intervene(runId, {
      kind: "answer",
      askId: second.askId,
      answer: ESCALATION_ABORT,
    });
    const step = await engine.next(runId);
    expect(step).toMatchObject({ kind: "failed", error: { code: "aborted_by_user" } });
  });

  it("forge.ask_user blocks the loop until the answer arrives and passes it as feedback", async () => {
    const { engine } = setup();
    const { runId, sessionCode } = await engine.createRun(REQUEST, "poc");
    const t = task((await engine.attach(sessionCode)).next);
    const { askId, next } = await engine.askUser({
      runId,
      taskId: t.taskId,
      question: "More defence or more speed?",
      options: ["Defence", "Speed"],
    });
    expect(next.kind).toBe("wait_user");
    await expect(
      engine.intervene(runId, { kind: "answer", askId, answer: "Something else" }),
    ).rejects.toMatchObject({ code: "invalid_intervention" });
    await engine.intervene(runId, { kind: "answer", askId, answer: "Speed" });
    const again = task(await engine.next(runId));
    expect(again.taskId).toBe(t.taskId);
    expect(again.feedback).toEqual([{ kind: "answer", askId, answer: "Speed" }]);
  });

  it("long-polls forge_next while waiting and wakes on an intervention", async () => {
    const { engine } = setup({ config: { ...CONFIG, waitLongPollSeconds: 5 } });
    const { runId, sessionCode } = await engine.createRun(REQUEST, "poc");
    await engine.attach(sessionCode);
    await engine.intervene(runId, { kind: "pause" });
    const started = Date.now();
    const pending = engine.next(runId);
    await new Promise((r) => setTimeout(r, 50));
    await engine.intervene(runId, { kind: "resume" });
    const step = await pending;
    expect(step.kind).toBe("task");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("redoStage drops the stage's results and plans it again", async () => {
    const { engine } = setup();
    const { runId, sessionCode } = await engine.createRun(REQUEST, "poc");
    let t = task((await engine.attach(sessionCode)).next);
    const out = await engine.submit({
      runId,
      taskId: t.taskId,
      attempt: 1,
      payload: candidate("a", "FixClassA", "FixAscA1"),
    });
    t = task(out.next);
    expect(t.context).toMatchObject({ previousCandidates: [{ key: "a" }] });
    await engine.intervene(runId, { kind: "redoStage", stage: "S2" });
    t = task(await engine.next(runId));
    expect(t.context).toMatchObject({ previousCandidates: [] });
    expect(t.feedback).toEqual([{ kind: "redoStage", stage: "S2" }]);
  });

  it("refuses stale submissions, unknown runs and expired codes", async () => {
    let now = new Date("2026-11-24T12:00:00Z");
    const { engine } = setup({ now: () => now });
    const { runId, sessionCode } = await engine.createRun(REQUEST, "poc");
    const t = task((await engine.attach(sessionCode)).next);
    await expect(
      engine.submit({ runId, taskId: t.taskId, attempt: 2, payload: {} }),
    ).rejects.toMatchObject({ code: "stale_task" });
    await expect(engine.next("not-a-run")).rejects.toMatchObject({ code: "unknown_run" });
    await expect(engine.attach("ZZZZ-ZZ")).rejects.toMatchObject({ code: "unknown_session_code" });
    now = new Date(now.getTime() + (CONFIG.sessionCodeTtlMinutes + 1) * 60_000);
    await expect(engine.attach(sessionCode)).rejects.toMatchObject({
      code: "session_code_expired",
    });
    const fresh = await engine.issueSessionCode(runId);
    expect((await engine.attach(fresh.sessionCode)).runId).toBe(runId);
  });

  it("checks rationale subjects (G1), digits in titles and excluded supports", async () => {
    const { engine } = setup();
    const request = { ...REQUEST, exclusions: [{ kind: "gem" as const, id: "FixGemSupport" }] };
    const { runId, sessionCode } = await engine.createRun(request, "poc");
    let t = task((await engine.attach(sessionCode)).next);
    const titled = candidate("a", "FixClassA", "FixAscA1");
    titled["title"] = "Build 2";
    let out = await engine.submit({ runId, taskId: t.taskId, attempt: 1, payload: titled });
    if (out.result !== "rejected") throw new Error("expected rejection");
    expect(out.findings[0]).toMatchObject({ code: "free_number", path: "/title" });
    t = task(out.next);
    out = await engine.submit({
      runId,
      taskId: t.taskId,
      attempt: 2,
      payload: candidate("a", "FixClassA", "FixAscA1"),
    });
    t = task(out.next);
    await engine.submit({
      runId,
      taskId: t.taskId,
      attempt: 1,
      payload: candidate("b", "FixClassB", "FixAscB1"),
    });
    await engine.intervene(runId, { kind: "chooseVariant", candidateKey: "a" });
    t = task(await engine.next(runId));

    const withSubject = gemSetup();
    withSubject["rationale"] = [
      { subject: { kind: "gem", id: "InventedGem" }, reason: [{ type: "text", text: "why" }] },
    ];
    out = await engine.submit({ runId, taskId: t.taskId, attempt: 1, payload: withSubject });
    if (out.result !== "rejected") throw new Error("expected rejection");
    expect(out.findings[0]).toMatchObject({ code: "unknown_entity", path: "/rationale/0/subject" });
    t = task(out.next);
    out = await engine.submit({ runId, taskId: t.taskId, attempt: 2, payload: gemSetup() });
    if (out.result !== "rejected") throw new Error("expected rejection");
    expect(out.findings[0]).toMatchObject({
      code: "excluded_entity",
      path: "/skills/0/supports/0/gemId",
    });
  });

  it("refuses a build request with unknown catalog ids", async () => {
    const { engine } = setup();
    await expect(
      engine.createRun({ ...REQUEST, mainSkillId: "InventedGem" as never }, "poc"),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("refuses attach after too many wrong codes (guessing guard)", async () => {
    let now = new Date("2026-11-24T12:00:00Z");
    const { engine } = setup({ now: () => now });
    const { sessionCode } = await engine.createRun(REQUEST, "poc");
    for (let i = 0; i < CONFIG.attachFailuresPerMinute; i += 1) {
      await expect(engine.attach("ZZZZ-ZZ")).rejects.toMatchObject({
        code: "unknown_session_code",
      });
    }
    await expect(engine.attach(sessionCode)).rejects.toMatchObject({ code: "too_many_attempts" });
    now = new Date(now.getTime() + 61_000);
    await expect(engine.attach(sessionCode)).resolves.toBeTruthy();
  });

  it("reports a failed calculation as a G2 finding, never as a value", async () => {
    const calc = new CalcFake({
      dataReleaseId: RELEASE,
      failWhen: (state) =>
        state.skills.length > 0 && state.skills[0]?.supports.length ? "boom" : undefined,
    });
    const { engine } = setup({ calc });
    const { runId, sessionCode } = await engine.createRun(REQUEST, "poc");
    let step = (await engine.attach(sessionCode)).next;
    for (const [key, cls, asc] of [
      ["a", "FixClassA", "FixAscA1"],
      ["b", "FixClassB", "FixAscB1"],
    ] as const) {
      const t = task(step);
      step = (
        await engine.submit({
          runId,
          taskId: t.taskId,
          attempt: 1,
          payload: candidate(key, cls, asc),
        })
      ).next;
    }
    await engine.intervene(runId, { kind: "chooseVariant", candidateKey: "a" });
    const t = task(await engine.next(runId));
    const out = await engine.submit({ runId, taskId: t.taskId, attempt: 1, payload: gemSetup() });
    if (out.result !== "rejected") throw new Error("expected rejection");
    expect(out.findings[0]).toMatchObject({ gate: "G2", code: "calc_failed" });
    const types = engine.eventsAfter(runId, -1).map((e) => e.type);
    expect(types).toContain("calc.failed");
  });

  it("keeps the run across a restart (SQLite file)", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "exileforge-db-")), "runs.sqlite");
    const first = setup({ dbPath });
    const { runId, sessionCode } = await first.engine.createRun(REQUEST, "poc");
    const t = task((await first.engine.attach(sessionCode)).next);
    await first.engine.submit({ runId, taskId: t.taskId, attempt: 1, payload: {} });
    first.store.close();

    const second = setup({ dbPath });
    const again = task(await second.engine.next(runId));
    expect(again).toMatchObject({ taskId: t.taskId, attempt: 2 });
    expect(second.engine.eventsAfter(runId, -1).length).toBeGreaterThan(0);
    second.store.close();
  });
});
