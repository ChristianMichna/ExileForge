import type { JsonValue } from "@exileforge/contracts/common";
import type { PipelineContext } from "../pipeline.js";

/** The request as task context: what the player wants, without ids of the run. */
export function requestContext(ctx: PipelineContext): JsonValue {
  const r = ctx.run.request;
  return {
    dataReleaseId: r.dataReleaseId,
    skillIdea: r.skillIdea,
    mainSkillId: r.mainSkillId ?? null,
    mode: r.mode,
    budget: r.budget,
    preferences: r.preferences,
    exclusions: r.exclusions,
    notes: r.notes ?? null,
  };
}
