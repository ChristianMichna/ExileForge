import { z } from "zod";
import type { TargetBuild } from "@astrolabe/contracts/build";
import {
  type ArchetypeCandidate,
  BuildState,
  CalcOutcome,
  type Finding,
  ProgressionPlan,
  Rationale,
  RichText,
  type SkillProfile,
} from "@astrolabe/contracts/build";
import { CalcProfileId, PassiveNodeId, type JsonValue } from "@astrolabe/contracts/common";
import type { StageConfig } from "../config.js";
import type { ProgressionStageTree } from "../ports.js";
import { defineTask, type AnyTaskSpec, type PipelineContext, type PlanStep } from "../pipeline.js";
import { S6_NOTES } from "../prompts.js";
import { requestContext } from "./context.js";

export const S6_STAGES_KEY = "S6.stages";
export const S6_NOTES_KEY = "S6.notes";
export const S6_PLAN_KEY = "S6.plan";

/** S6 settings; absent when the stage table has not been set yet. */
export type S6Config = NonNullable<StageConfig["s6"]>;

/** Stored result of the S6.stages job; checked again when read back. */
export const StoredStages = z.array(
  z.object({
    key: z.string().min(1),
    state: BuildState,
    allocationOrder: z.array(PassiveNodeId),
    respecs: z.array(PassiveNodeId),
    unspent: z.int().nonnegative(),
    calcs: z.record(CalcProfileId, CalcOutcome),
  }),
);

/** What Claude writes per stage; everything measured comes from the optimizer. */
export const ProgressionNotes = z.object({
  stages: z.array(
    z.object({
      key: z.string().min(1),
      tasks: z.array(RichText).min(1),
      dangers: z.array(RichText).default([]),
      rationale: z.array(Rationale).default([]),
    }),
  ),
});
export type ProgressionNotes = z.infer<typeof ProgressionNotes>;

/** S6 part 1: orders the target tree into nested stages (PoB optimiser, background job). */
export function stagesJob(
  ctx: PipelineContext,
  s6: S6Config,
  profile: SkillProfile,
  chosen: ArchetypeCandidate,
  target: TargetBuild,
): PlanStep {
  const progression = ctx.progression;
  if (progression === undefined) {
    return {
      kind: "blocked",
      error: {
        code: "progression_unavailable",
        message:
          "S6 orders the target tree with Path of Building. This server runs without the PoB calculation service, so the progression cannot be built.",
      },
    };
  }
  return {
    kind: "job",
    key: S6_STAGES_KEY,
    type: "S6.stages",
    label: "ordering the passive tree into progression stages with Path of Building",
    run: async (runCtx) => {
      const result = await progression.optimizeProgression({
        request: runCtx.run.request,
        profile,
        candidate: chosen,
        target,
        stages: s6.stages.map((s) => ({
          key: s.key,
          budget: s.passivePoints,
          level: s.levelRange[1],
        })),
      });
      return JSON.parse(JSON.stringify(result)) as JsonValue;
    },
  };
}

/** S6 part 2: the texts per stage (Claude); every stage key exactly once. */
export function notesTask(
  ctx: PipelineContext,
  config: StageConfig,
  s6: S6Config,
  trees: readonly ProgressionStageTree[],
): AnyTaskSpec {
  const keys = s6.stages.map((s) => s.key);
  return defineTask<ProgressionNotes>({
    key: S6_NOTES_KEY,
    type: "S6.notes",
    promptVersion: config.promptVersion,
    instructions: S6_NOTES,
    context: {
      request: requestContext(ctx),
      stages: JSON.parse(
        JSON.stringify(
          s6.stages.map((s) => ({
            key: s.key,
            label: s.label,
            kind: s.kind,
            act: s.act,
            levelRange: s.levelRange,
            newNodes: trees.find((t) => t.key === s.key)?.allocationOrder,
          })),
        ),
      ) as JsonValue,
    },
    schema: ProgressionNotes,
    allowedTools: ["catalog_search", "catalog_get", "calc_evaluate"],
    entities: (n) =>
      n.stages.flatMap((st, i) =>
        st.rationale.flatMap((r, j) =>
          r.subject === undefined
            ? []
            : [{ path: `/stages/${i}/rationale/${j}/subject`, ref: r.subject }],
        ),
      ),
    richText: (n) =>
      n.stages.flatMap((st, i) => [
        ...st.tasks.map((t, j) => ({ path: `/stages/${i}/tasks/${j}`, text: t })),
        ...st.dangers.map((t, j) => ({ path: `/stages/${i}/dangers/${j}`, text: t })),
        ...st.rationale.map((r, j) => ({
          path: `/stages/${i}/rationale/${j}/reason`,
          text: r.reason,
        })),
      ]),
    check: (n) => {
      const findings: Finding[] = [];
      const seen = new Set<string>();
      n.stages.forEach((st, i) => {
        if (!keys.includes(st.key) || seen.has(st.key)) {
          findings.push({
            gate: "schema",
            severity: "error",
            code: "unknown_or_duplicate_stage",
            message: `Stage key ${st.key} is unknown or given twice. Use each of: ${keys.join(", ")}.`,
            path: `/stages/${i}/key`,
          });
        }
        seen.add(st.key);
      });
      for (const key of keys) {
        if (!seen.has(key)) {
          findings.push({
            gate: "schema",
            severity: "error",
            code: "missing_stage",
            message: `Stage ${key} has no entry.`,
            path: "/stages",
          });
        }
      }
      return Promise.resolve(findings);
    },
  });
}

/** S6 part 3: assembles the validated plan from the optimiser's stages and the notes. */
export function planStep(
  s6: S6Config,
  trees: readonly ProgressionStageTree[],
  notes: ProgressionNotes,
): PlanStep {
  return {
    kind: "server",
    key: S6_PLAN_KEY,
    type: "S6.plan",
    run: () => {
      const stages = s6.stages.map((cfg, order) => {
        const tree = trees.find((t) => t.key === cfg.key);
        const note = notes.stages.find((n) => n.key === cfg.key);
        if (tree === undefined || note === undefined) {
          throw new Error(`Stage ${cfg.key} is missing from the stored S6 results`);
        }
        return {
          key: cfg.key,
          order,
          label: cfg.label,
          kind: cfg.kind,
          ...(cfg.act === undefined ? {} : { act: cfg.act }),
          levelRange: cfg.levelRange,
          state: tree.state,
          allocationOrder: tree.allocationOrder,
          respecs: tree.respecs,
          tasks: note.tasks,
          dangers: note.dangers,
          rationale: note.rationale,
          calcs: tree.calcs,
        };
      });
      const parsed = ProgressionPlan.safeParse({ stages });
      if (!parsed.success) {
        throw new Error("The stored S6 stages are not a valid progression plan", {
          cause: parsed.error,
        });
      }
      return Promise.resolve(JSON.parse(JSON.stringify(parsed.data)) as JsonValue);
    },
  };
}
