import { z } from "zod";
import { CalcId, IsoDateTime } from "../common/version.js";
import { Finding } from "../build/findings.js";
import { TaskType } from "../build/findings.js";
import { RunId, RunPhase, TaskId, UserIntervention } from "../forge/tools.js";

/*
 * Live status from apps/server to apps/web (Server-Sent Events). One event per
 * state change of a run; `seq` is strictly increasing per run so the frontend
 * can detect gaps and re-fetch the status instead of guessing.
 */

const base = {
  runId: RunId,
  seq: z.int().nonnegative(),
  at: IsoDateTime,
};

export const RunEvent = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("run.phase"), phase: RunPhase }),
  z.object({
    ...base,
    type: z.literal("task.started"),
    taskId: TaskId,
    task: TaskType,
    attempt: z.int().positive(),
  }),
  z.object({ ...base, type: z.literal("task.submitted"), taskId: TaskId }),
  z.object({ ...base, type: z.literal("task.accepted"), taskId: TaskId }),
  z.object({
    ...base,
    type: z.literal("task.rejected"),
    taskId: TaskId,
    findings: z.array(Finding).min(1),
    attempt: z.int().positive(),
    maxAttempts: z.int().positive(),
  }),
  z.object({ ...base, type: z.literal("calc.completed"), calcId: CalcId }),
  z.object({
    ...base,
    type: z.literal("calc.failed"),
    error: z.object({ code: z.string().min(1), message: z.string().min(1) }),
  }),
  z.object({
    ...base,
    type: z.literal("ask_user"),
    askId: z.string().min(1),
    question: z.string().min(1),
    options: z.array(z.string()),
  }),
  z.object({ ...base, type: z.literal("feedback.queued"), intervention: UserIntervention }),
  z.object({ ...base, type: z.literal("guide.ready"), guideId: z.uuid() }),
]);
export type RunEvent = z.infer<typeof RunEvent>;
