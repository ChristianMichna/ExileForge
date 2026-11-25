import { SkillProfile } from "@exileforge/contracts/build";
import type { JsonValue } from "@exileforge/contracts/common";
import type { UserIntervention } from "@exileforge/contracts/forge";
import type { StageConfig } from "./config.js";
import type { Pipeline, PipelineContext, PlanStep } from "./pipeline.js";
import { S0_SKILL_KEY, SkillChoice, skillTask } from "./stages/s0-skill.js";
import { profileBase, profileTask, S1_BASE_KEY, S1_PROFILE_KEY } from "./stages/s1-profile.js";
import { candidatesOf, candidateTask } from "./stages/s2-candidates.js";
import { evaluationsJob, S3_KEY } from "./stages/s3-evaluate.js";
import { S4_KEY, selectionStep, selectionWait } from "./stages/s4-select.js";

export const FORGE_PIPELINE_ID = "forge";

/**
 * The real pipeline, stage by stage as the stages get built. Today: S0
 * (main skill), S1 (mechanics), S2 (archetype candidates), S3 (skeleton
 * measurement as a background job), S4 (the player's choice). Everything after
 * needs packages that do not exist yet (optimizer, crafting simulator,
 * economy) and ends the run with an explicit "not implemented" error instead
 * of inventing results.
 */
export function createForgePipeline(config: StageConfig): Pipeline {
  const mainSkillOf = (ctx: PipelineContext): string | undefined => {
    if (ctx.run.request.mainSkillId !== undefined) return ctx.run.request.mainSkillId;
    const chosen = ctx.result(S0_SKILL_KEY);
    return chosen === undefined ? undefined : SkillChoice.parse(chosen).mainSkillId;
  };

  return {
    id: FORGE_PIPELINE_ID,
    plannedTasks: (ctx) =>
      (ctx.run.request.mainSkillId === undefined ? 1 : 0) + 1 + config.s2.candidateCount,
    validateIntervention: (intervention: UserIntervention, ctx) => {
      if (intervention.kind !== "chooseVariant") return undefined;
      if (ctx.result(S3_KEY) === undefined) {
        return "The candidates are not measured yet; choose after the calculation is done";
      }
      if (ctx.result(S4_KEY) !== undefined) {
        return "A variant is already chosen; redo stage S4 to choose again";
      }
      const keys = candidatesOf(ctx, config.s2.candidateCount).map((c) => c.key);
      return keys.includes(intervention.candidateKey)
        ? undefined
        : `Unknown variant ${intervention.candidateKey}`;
    },
    plan: (ctx): PlanStep => {
      const mainSkillId = mainSkillOf(ctx);
      if (mainSkillId === undefined) return { kind: "task", spec: skillTask(ctx, config) };

      const base = ctx.result(S1_BASE_KEY);
      if (base === undefined) {
        const problem = presetSkillProblem(ctx, mainSkillId, config);
        if (problem !== undefined) {
          return { kind: "blocked", error: { code: "invalid_main_skill", message: problem } };
        }
        return {
          kind: "server",
          key: S1_BASE_KEY,
          type: "S1.base",
          run: async (runCtx) => profileBase(runCtx, mainSkillId),
        };
      }
      const profileExtension = ctx.result(S1_PROFILE_KEY);
      if (profileExtension === undefined) {
        return {
          kind: "task",
          spec: profileTask(ctx, config, base as { mainSkillId: string; tags: string[] }),
        };
      }
      const profile: JsonValue = {
        ...(base as Record<string, JsonValue>),
        ...(profileExtension as Record<string, JsonValue>),
      };

      const candidates = candidatesOf(ctx, config.s2.candidateCount);
      if (candidates.length < config.s2.candidateCount) {
        return {
          kind: "task",
          spec: candidateTask(ctx, config, candidates.length + 1, candidates, profile),
        };
      }
      if (ctx.result(S3_KEY) === undefined) {
        const parsed = SkillProfile.safeParse(profile);
        if (!parsed.success) {
          return {
            kind: "blocked",
            error: {
              code: "invalid_profile",
              message: `The stored skill profile is not valid: ${parsed.error.message.slice(0, 500)}`,
            },
          };
        }
        return evaluationsJob(ctx, parsed.data, candidates);
      }
      if (ctx.result(S4_KEY) === undefined) {
        const choice = ctx.latest("chooseVariant");
        if (choice === undefined) return selectionWait(candidates);
        return selectionStep(choice.candidateKey);
      }
      return {
        kind: "blocked",
        error: {
          code: "stage_not_implemented",
          message:
            "S5 (target build) and the later stages are not built yet. S0 to S4 are done; their results are stored with the run.",
        },
      };
    },
  };
}

/** The player's own pick skips S0, so it gets the same checks here. */
function presetSkillProblem(
  ctx: PipelineContext,
  mainSkillId: string,
  config: StageConfig,
): string | undefined {
  const gem = ctx.catalog.get({ kind: "gem", id: mainSkillId });
  if (gem === undefined) {
    return `Main skill ${mainSkillId} is not in data release ${ctx.catalog.dataReleaseId}.`;
  }
  const kind = (gem.entity as { kind?: string }).kind;
  if (kind !== undefined && config.supportGemKinds.includes(kind)) {
    return `Main skill ${mainSkillId} is a support gem and cannot be the main skill.`;
  }
  if (ctx.run.request.exclusions.some((x) => x.kind === "gem" && x.id === mainSkillId)) {
    return `Main skill ${mainSkillId} is on the player's exclusion list.`;
  }
  return undefined;
}
