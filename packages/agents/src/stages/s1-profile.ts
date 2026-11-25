import type { z } from "zod";
import { SkillProfile, type Finding } from "@astrolabe/contracts/build";
import type { EntityRef, JsonValue } from "@astrolabe/contracts/common";
import type { StageConfig } from "../config.js";
import { defineTask, type AnyTaskSpec, type PipelineContext } from "../pipeline.js";
import { S1_PROFILE } from "../prompts.js";
import { requestContext } from "./context.js";

/** What Claude adds to the deterministic base of the profile. */
export const ProfileExtension = SkillProfile.omit({ mainSkillId: true, tags: true });
export type ProfileExtension = z.infer<typeof ProfileExtension>;

export const S1_BASE_KEY = "S1.base";
export const S1_PROFILE_KEY = "S1.profile";

/** Deterministic base: the main skill's own tags from the catalog, nothing guessed. */
export function profileBase(ctx: PipelineContext, mainSkillId: string): JsonValue {
  const gem = ctx.catalog.get({ kind: "gem", id: mainSkillId });
  const tags = (gem?.entity as { tags?: string[] } | undefined)?.tags;
  if (tags === undefined) {
    throw new Error(
      `Main skill ${mainSkillId} is not in data release ${ctx.catalog.dataReleaseId}`,
    );
  }
  return { mainSkillId, tags: [...tags] };
}

/** S1: mechanics analysis. The base is deterministic, the lists come from Claude and are checked against the catalog. */
export function profileTask(
  ctx: PipelineContext,
  config: StageConfig,
  base: { mainSkillId: string; tags: string[] },
): AnyTaskSpec {
  const max = config.s1.maxListItems;
  return defineTask({
    key: S1_PROFILE_KEY,
    type: "S1.profile",
    promptVersion: config.promptVersion,
    instructions: S1_PROFILE,
    context: { request: requestContext(ctx), base, maxItemsPerList: max },
    schema: ProfileExtension,
    allowedTools: ["catalog_search", "catalog_get"],
    entities: (p) => entityRefs(p),
    richText: (p) => p.notes.map((n, i) => ({ path: `/notes/${i}/reason`, text: n.reason })),
    check: async (p, checkCtx) => {
      const findings: Finding[] = [];
      for (const [name, list] of [
        ["scalingStats", p.scalingStats],
        ["supportCandidates", p.supportCandidates],
        ["relevantUniques", p.relevantUniques],
        ["relevantNodes", p.relevantNodes],
        ["ascendancyCandidates", p.ascendancyCandidates],
      ] as const) {
        if (list.length > max) {
          findings.push({
            gate: "schema",
            severity: "error",
            code: "list_too_long",
            message: `${name} has ${list.length} entries, at most ${max} are allowed. Keep the most relevant ones.`,
            path: `/${name}`,
          });
        }
      }
      p.scalingStats.forEach((statId, i) => {
        if (!checkCtx.catalog.hasStat(statId)) {
          findings.push({
            gate: "G1",
            severity: "error",
            code: "unknown_stat",
            message: `Unknown stat id ${JSON.stringify(statId)} in data release ${checkCtx.catalog.dataReleaseId}. Use ids that appear in catalog_get results.`,
            path: `/scalingStats/${i}`,
          });
        }
      });
      p.supportCandidates.forEach((id, i) => {
        const kind = (
          checkCtx.catalog.get({ kind: "gem", id })?.entity as { kind?: string } | undefined
        )?.kind;
        if (kind !== undefined && !config.supportGemKinds.includes(kind)) {
          findings.push({
            gate: "G1",
            severity: "error",
            code: "not_a_support_gem",
            message: `Gem ${JSON.stringify(id)} is not a support gem (kind ${JSON.stringify(kind)}).`,
            path: `/supportCandidates/${i}`,
            entity: { kind: "gem", id },
          });
        }
      });
      return findings;
    },
  });
}

function entityRefs(p: ProfileExtension): { path: string; ref: EntityRef }[] {
  return [
    ...p.supportCandidates.map((id, i) => ({
      path: `/supportCandidates/${i}`,
      ref: { kind: "gem" as const, id },
    })),
    ...p.relevantUniques.map((id, i) => ({
      path: `/relevantUniques/${i}`,
      ref: { kind: "uniqueItem" as const, id },
    })),
    ...p.relevantNodes.map((id, i) => ({
      path: `/relevantNodes/${i}`,
      ref: { kind: "passiveNode" as const, id },
    })),
    ...p.ascendancyCandidates.map((id, i) => ({
      path: `/ascendancyCandidates/${i}`,
      ref: { kind: "ascendancy" as const, id },
    })),
    ...p.notes.flatMap((n, i) =>
      n.subject === undefined ? [] : [{ path: `/notes/${i}/subject`, ref: n.subject }],
    ),
  ];
}
