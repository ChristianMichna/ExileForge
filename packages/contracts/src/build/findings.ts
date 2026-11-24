import { z } from "zod";
import { EntityRef } from "../common/ids.js";
import { CalcId } from "../common/version.js";

/** Pipeline stage S0–S11 plus optional part, e.g. "S5.gems". */
export const TaskType = z.string().regex(/^S(?:[0-9]|1[01])(?:\.[a-z][a-z0-9-]*)?$/);
export type TaskType = z.infer<typeof TaskType>;

/** Quality gates of the plan (G1–G8) plus schema and engine checks. */
export const GateId = z.enum(["schema", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"]);
export type GateId = z.infer<typeof GateId>;

/** One concrete problem, precise enough to be fixed by the step that caused it. */
export const Finding = z.object({
  gate: GateId,
  severity: z.enum(["error", "warning"]),
  /** Machine-readable code, e.g. "unknown_entity", "res_below_cap". */
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(2000),
  /** JSON pointer into the submitted payload or document. */
  path: z.string().startsWith("/").optional(),
  entity: EntityRef.optional(),
  /** Stage/task that caused the problem and gets it back (max. returns per stage from config). */
  returnTo: TaskType.optional(),
  /** Calculation the finding is based on, if any. */
  calcId: CalcId.optional(),
});
export type Finding = z.infer<typeof Finding>;

export const GateResult = z.object({
  gate: GateId,
  passed: z.boolean(),
  findings: z.array(Finding),
});
export type GateResult = z.infer<typeof GateResult>;

/** S10 result. */
export const ValidationReport = z.object({
  gates: z.array(GateResult),
  /** Completeness score 0–100 computed with the weights of `scoringConfigVersion` (config/guide-scoring). */
  completenessScore: z.number().min(0).max(100),
  scoringConfigVersion: z.string().min(1),
  passed: z.boolean(),
});
export type ValidationReport = z.infer<typeof ValidationReport>;
