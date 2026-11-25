import { z } from "zod";
import type { Finding } from "@astrolabe/contracts/build";
import { Rationale } from "@astrolabe/contracts/build";
import { GemId } from "@astrolabe/contracts/common";
import type { StageConfig } from "../config.js";
import { defineTask, type AnyTaskSpec, type PipelineContext } from "../pipeline.js";
import { S0_SKILL } from "../prompts.js";
import { requestContext } from "./context.js";

export const SkillChoice = z.object({
  mainSkillId: GemId,
  rationale: z.array(Rationale).min(1),
});
export type SkillChoice = z.infer<typeof SkillChoice>;

export const S0_SKILL_KEY = "S0.skill";

/** S0: resolve the main skill from the free-text idea when the player did not pick one. */
export function skillTask(ctx: PipelineContext, config: StageConfig): AnyTaskSpec {
  return defineTask<SkillChoice>({
    key: S0_SKILL_KEY,
    type: "S0.skill",
    promptVersion: config.promptVersion,
    instructions: S0_SKILL,
    context: requestContext(ctx),
    schema: SkillChoice,
    allowedTools: ["catalog_search", "catalog_get"],
    entities: (c) => [
      { path: "/mainSkillId", ref: { kind: "gem", id: c.mainSkillId } },
      ...c.rationale.flatMap((r, i) =>
        r.subject === undefined ? [] : [{ path: `/rationale/${i}/subject`, ref: r.subject }],
      ),
    ],
    richText: (c) =>
      c.rationale.map((r, i) => ({ path: `/rationale/${i}/reason`, text: r.reason })),
    check: async (c, checkCtx) => {
      const findings: Finding[] = [];
      const gem = checkCtx.catalog.get({ kind: "gem", id: c.mainSkillId });
      const kind = (gem?.entity as { kind?: string } | undefined)?.kind;
      if (kind !== undefined && config.supportGemKinds.includes(kind)) {
        findings.push({
          gate: "G1",
          severity: "error",
          code: "support_as_main_skill",
          message: "A support gem cannot be the main skill. Choose an active skill gem.",
          path: "/mainSkillId",
          entity: { kind: "gem", id: c.mainSkillId },
        });
      }
      if (checkCtx.run.request.exclusions.some((x) => x.kind === "gem" && x.id === c.mainSkillId)) {
        findings.push({
          gate: "G1",
          severity: "error",
          code: "excluded_entity",
          message: "The player excluded this skill. Choose another one.",
          path: "/mainSkillId",
          entity: { kind: "gem", id: c.mainSkillId },
        });
      }
      return findings;
    },
  });
}
