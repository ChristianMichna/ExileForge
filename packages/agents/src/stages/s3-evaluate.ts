import type { SkillProfile } from "@astrolabe/contracts/build";
import { ArchetypeEvaluation, type ArchetypeCandidate } from "@astrolabe/contracts/build";
import type { JsonValue } from "@astrolabe/contracts/common";
import type { PipelineContext, PlanStep } from "../pipeline.js";

export const S3_KEY = "S3.evaluations";

/**
 * S3: skeleton build and PoB measurement per candidate, one background job
 * (a tree optimisation takes minutes). Candidates run one after another so
 * the PoB pool is not flooded; a failed candidate fails the whole stage
 * visibly, a missing result is never filled in.
 */
export function evaluationsJob(
  ctx: PipelineContext,
  profile: SkillProfile,
  candidates: readonly ArchetypeCandidate[],
): PlanStep {
  const skeleton = ctx.skeleton;
  if (skeleton === undefined) {
    return {
      kind: "blocked",
      error: {
        code: "skeleton_unavailable",
        message:
          "S3 measures skeleton builds with Path of Building. This server runs without the PoB calculation service (calc-fake), so the candidates cannot be evaluated.",
      },
    };
  }
  return {
    kind: "job",
    key: S3_KEY,
    type: "S3.evaluate",
    label: `measuring ${candidates.length} candidate builds with Path of Building`,
    run: async (runCtx) => {
      const evaluations: ArchetypeEvaluation[] = [];
      for (const candidate of candidates) {
        evaluations.push(
          ArchetypeEvaluation.parse(
            await skeleton.evaluate({ request: runCtx.run.request, profile, candidate }),
          ),
        );
      }
      return JSON.parse(JSON.stringify(evaluations)) as JsonValue;
    },
  };
}
