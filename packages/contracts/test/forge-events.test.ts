import { describe, expect, it } from "vitest";
import { ForgeStep, ForgeTools, RunEvent, SessionCode, UserIntervention } from "../src/index.js";

const runId = "00000000-0000-4000-8000-000000000002";

const task = {
  taskId: "t-1",
  type: "S5.gems",
  attempt: 1,
  maxAttempts: 3,
  instructions: "Fixture instructions",
  promptVersion: "1",
  context: { candidateKey: "a" },
  feedback: [{ kind: "lock", entity: { kind: "gem", id: "Fixture/Gems/Main" } }],
  findings: [],
  responseSchema: { type: "object" },
  allowedTools: ["catalog.search"],
};

describe("forge tools", () => {
  it("defines the loop tools of ADR-0003", () => {
    expect(Object.keys(ForgeTools).sort()).toEqual(
      ["forge.ask_user", "forge.attach", "forge.next", "forge.status", "forge.submit"].sort(),
    );
  });

  it("session codes avoid ambiguous characters", () => {
    expect(SessionCode.safeParse("7F3K-QX").success).toBe(true);
    expect(SessionCode.safeParse("7F0K-QX").success).toBe(false);
    expect(SessionCode.safeParse("7f3k-qx").success).toBe(false);
  });

  it("next returns a task, wait, done or failed", () => {
    expect(ForgeStep.safeParse({ kind: "task", task }).error).toBeUndefined();
    expect(
      ForgeStep.safeParse({
        kind: "wait_user",
        reason: [{ type: "text", text: "Fixture" }],
        retryAfterSeconds: 30,
      }).success,
    ).toBe(true);
    expect(ForgeStep.safeParse({ kind: "task", task: { ...task, type: "S12" } }).success).toBe(
      false,
    );
  });

  it("a rejected submission carries findings and the next step", () => {
    const out = ForgeTools["forge.submit"].output;
    const rejected = {
      result: "rejected",
      findings: [
        { gate: "G1", severity: "error", code: "unknown_entity", message: "Fixture", path: "/a" },
      ],
      next: { kind: "task", task: { ...task, attempt: 2 } },
    };
    expect(out.safeParse(rejected).error).toBeUndefined();
    expect(out.safeParse({ ...rejected, findings: [] }).success).toBe(false);
  });

  it("submit input validates ids", () => {
    const input = ForgeTools["forge.submit"].input;
    expect(input.safeParse({ runId, taskId: "t-1", attempt: 1, payload: {} }).success).toBe(true);
    expect(input.safeParse({ runId: "x", taskId: "t-1", attempt: 1, payload: {} }).success).toBe(
      false,
    );
  });

  it("unknown interventions are rejected", () => {
    expect(UserIntervention.safeParse({ kind: "deleteRun" }).success).toBe(false);
  });
});

describe("RunEvent", () => {
  const base = { runId, seq: 1, at: "2026-01-01T00:00:00Z" };

  it("accepts the live status events", () => {
    const events = [
      { ...base, type: "run.phase", phase: "planning" },
      { ...base, type: "task.started", taskId: "t-1", task: "S5.gems", attempt: 1 },
      { ...base, type: "calc.completed", calcId: "calc-1" },
      { ...base, type: "calc.failed", error: { code: "timeout", message: "Fixture" } },
      { ...base, type: "guide.ready", guideId: runId },
    ];
    for (const e of events) expect(RunEvent.safeParse(e).error).toBeUndefined();
  });

  it("rejects events without sequence number", () => {
    expect(
      RunEvent.safeParse({ runId, at: base.at, type: "run.phase", phase: "done" }).success,
    ).toBe(false);
  });
});
