import type { RunEvent } from "@astrolabe/contracts/events";

/** What the status strip shows about a run, derived from its event stream only. */
export interface RunLive {
  readonly lastSeq: number;
  readonly phase: "planning" | "waiting_user" | "paused" | "done" | "failed" | "created";
  readonly currentTask: { readonly task: string; readonly attempt: number } | undefined;
  readonly acceptedTasks: number;
  readonly rejectedAttempts: number;
  readonly lastFindings: readonly string[];
  readonly calcCompleted: number;
  readonly calcFailure: string | undefined;
  readonly question: { readonly question: string; readonly options: readonly string[] } | undefined;
  readonly guideReady: boolean;
}

export const EMPTY_RUN: RunLive = {
  lastSeq: -1,
  phase: "created",
  currentTask: undefined,
  acceptedTasks: 0,
  rejectedAttempts: 0,
  lastFindings: [],
  calcCompleted: 0,
  calcFailure: undefined,
  question: undefined,
  guideReady: false,
};

/** Folds one event into the state. Events at or below `lastSeq` are ignored (replays). */
export function applyRunEvent(state: RunLive, event: RunEvent): RunLive {
  if (event.seq <= state.lastSeq) return state;
  const next = { ...state, lastSeq: event.seq };
  switch (event.type) {
    case "run.phase":
      return {
        ...next,
        phase: event.phase,
        question: event.phase === "waiting_user" ? next.question : undefined,
      };
    case "task.started":
      return {
        ...next,
        currentTask: { task: event.task, attempt: event.attempt },
        lastFindings: event.attempt === 1 ? [] : next.lastFindings,
      };
    case "task.submitted":
      return next;
    case "task.accepted":
      return {
        ...next,
        acceptedTasks: next.acceptedTasks + 1,
        currentTask: undefined,
        lastFindings: [],
      };
    case "task.rejected":
      return {
        ...next,
        rejectedAttempts: next.rejectedAttempts + 1,
        lastFindings: event.findings.map((f) => f.message),
      };
    case "calc.completed":
      return { ...next, calcCompleted: next.calcCompleted + 1, calcFailure: undefined };
    case "calc.failed":
      return { ...next, calcFailure: event.error.message };
    case "ask_user":
      return { ...next, question: { question: event.question, options: event.options } };
    case "feedback.queued":
      return next;
    case "guide.ready":
      return { ...next, guideReady: true };
  }
}
