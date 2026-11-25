import { describe, expect, it } from "vitest";
import type { RunEvent } from "@exileforge/contracts/events";
import { applyRunEvent, EMPTY_RUN } from "./run-state";

const base = { runId: "r1", at: "2026-01-01T00:00:00Z" };
const ev = (seq: number, rest: Record<string, unknown>) => ({ ...base, seq, ...rest }) as RunEvent;

describe("applyRunEvent", () => {
  it("tracks phase, tasks and sent-back answers", () => {
    let s = EMPTY_RUN;
    s = applyRunEvent(s, ev(0, { type: "run.phase", phase: "planning" }));
    s = applyRunEvent(
      s,
      ev(1, { type: "task.started", taskId: "t1", task: "S2.candidates", attempt: 1 }),
    );
    s = applyRunEvent(
      s,
      ev(2, {
        type: "task.rejected",
        taskId: "t1",
        attempt: 1,
        maxAttempts: 3,
        findings: [
          { gate: "G1", severity: "error", code: "unknown_entity", message: "No such gem" },
        ],
      }),
    );
    expect(s.lastFindings).toEqual(["No such gem"]);
    expect(s.rejectedAttempts).toBe(1);
    s = applyRunEvent(
      s,
      ev(3, { type: "task.started", taskId: "t1", task: "S2.candidates", attempt: 2 }),
    );
    expect(s.lastFindings).toEqual(["No such gem"]);
    s = applyRunEvent(s, ev(4, { type: "task.accepted", taskId: "t1" }));
    expect(s).toMatchObject({
      phase: "planning",
      acceptedTasks: 1,
      currentTask: undefined,
      lastFindings: [],
    });
  });

  it("ignores replayed events", () => {
    const first = applyRunEvent(EMPTY_RUN, ev(5, { type: "calc.completed", calcId: "c" }));
    const again = applyRunEvent(first, ev(5, { type: "calc.completed", calcId: "c" }));
    expect(again.calcCompleted).toBe(1);
    expect(again).toBe(first);
  });

  it("shows a failed calculation and clears it after the next success", () => {
    let s = applyRunEvent(
      EMPTY_RUN,
      ev(0, { type: "calc.failed", error: { code: "timeout", message: "Worker timed out" } }),
    );
    expect(s.calcFailure).toBe("Worker timed out");
    s = applyRunEvent(s, ev(1, { type: "calc.completed", calcId: "c" }));
    expect(s.calcFailure).toBeUndefined();
  });

  it("keeps the question until the run leaves waiting_user", () => {
    let s = applyRunEvent(
      EMPTY_RUN,
      ev(0, { type: "ask_user", askId: "a", question: "Which one?", options: ["A"] }),
    );
    s = applyRunEvent(s, ev(1, { type: "run.phase", phase: "waiting_user" }));
    expect(s.question?.question).toBe("Which one?");
    s = applyRunEvent(s, ev(2, { type: "run.phase", phase: "planning" }));
    expect(s.question).toBeUndefined();
  });
});
