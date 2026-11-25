import { ArchetypeCandidate, type Finding } from "@astrolabe/contracts/build";
import type { Ascendancy } from "@astrolabe/contracts/catalog";
import type { EntityRef, JsonValue } from "@astrolabe/contracts/common";
import type { StageConfig } from "../config.js";
import { defineTask, type AnyTaskSpec, type PipelineContext } from "../pipeline.js";
import { S2_CANDIDATE } from "../prompts.js";
import { requestContext } from "./context.js";

const DIGIT = /\p{Nd}/u;

export const candidateKey = (index: number): string => `S2.candidate-${index}`;

/** Entities the player locked/rejected, from the request and from live interventions. */
export function userEntities(ctx: PipelineContext): { locked: EntityRef[]; rejected: EntityRef[] } {
  return {
    locked: ctx.run.interventions.flatMap((e) =>
      e.intervention.kind === "lock" ? [e.intervention.entity] : [],
    ),
    rejected: [
      ...ctx.run.request.exclusions,
      ...ctx.run.interventions.flatMap((e) =>
        e.intervention.kind === "reject" ? [e.intervention.entity] : [],
      ),
    ],
  };
}

/** Findings for references to entities the player excluded. */
export function rejectedFindings(
  ctx: PipelineContext,
  refs: readonly { path: string; ref: EntityRef }[],
): Finding[] {
  const { rejected } = userEntities(ctx);
  return refs
    .filter(({ ref }) => rejected.some((x) => x.kind === ref.kind && x.id === ref.id))
    .map(({ path, ref }) => ({
      gate: "G1",
      severity: "error",
      code: "excluded_entity",
      message: `The user excluded ${ref.kind} ${JSON.stringify(ref.id)}. Choose something else.`,
      path,
      entity: ref,
    }));
}

export function candidatesOf(ctx: PipelineContext, count: number): ArchetypeCandidate[] {
  const list: ArchetypeCandidate[] = [];
  for (let i = 1; i <= count; i += 1) {
    const value = ctx.result(candidateKey(i));
    if (value !== undefined) list.push(ArchetypeCandidate.parse(value));
  }
  return list;
}

/** S2: one archetype candidate per task, each different from the earlier ones. */
export function candidateTask(
  ctx: PipelineContext,
  config: StageConfig,
  index: number,
  previous: readonly ArchetypeCandidate[],
  profile: JsonValue,
): AnyTaskSpec {
  const refsOf = (c: ArchetypeCandidate) => [
    { path: "/classId", ref: { kind: "characterClass" as const, id: c.classId } },
    { path: "/ascendancyId", ref: { kind: "ascendancy" as const, id: c.ascendancyId } },
    ...c.keyEntities.map((ref, i) => ({ path: `/keyEntities/${i}`, ref })),
  ];
  return defineTask<ArchetypeCandidate>({
    key: candidateKey(index),
    type: "S2.candidate",
    promptVersion: config.promptVersion,
    instructions: S2_CANDIDATE(index, config.s2.candidateCount),
    context: {
      request: requestContext(ctx),
      profile,
      previousCandidates: previous.map((c) => ({
        key: c.key,
        title: c.title,
        classId: c.classId,
        ascendancyId: c.ascendancyId,
      })),
      ...userEntities(ctx),
    },
    schema: ArchetypeCandidate,
    allowedTools: ["catalog_search", "catalog_get"],
    entities: refsOf,
    richText: (c) => [
      { path: "/damageRoute", text: c.damageRoute },
      { path: "/defenceConcept", text: c.defenceConcept },
      { path: "/hypothesis", text: c.hypothesis },
    ],
    check: async (c, checkCtx) => {
      const findings: Finding[] = [];
      if (DIGIT.test(c.title)) {
        findings.push({
          gate: "G8",
          severity: "error",
          code: "free_number",
          message: "The title contains a number. Titles are words only.",
          path: "/title",
        });
      }
      if (c.keyEntities.length > config.s2.maxKeyEntities) {
        findings.push({
          gate: "schema",
          severity: "error",
          code: "list_too_long",
          message: `keyEntities has ${c.keyEntities.length} entries, at most ${config.s2.maxKeyEntities} are allowed.`,
          path: "/keyEntities",
        });
      }
      if (previous.some((p) => p.key === c.key)) {
        findings.push({
          gate: "schema",
          severity: "error",
          code: "duplicate_key",
          message: `Candidate key ${JSON.stringify(c.key)} is already used. Pick a new key.`,
          path: "/key",
        });
      }
      if (previous.some((p) => p.classId === c.classId && p.ascendancyId === c.ascendancyId)) {
        findings.push({
          gate: "G8",
          severity: "error",
          code: "not_distinct",
          message:
            "Class and ascendancy equal an earlier candidate. Candidates must differ in class or ascendancy.",
          path: "/ascendancyId",
        });
      }
      const asc = checkCtx.catalog.get({ kind: "ascendancy", id: c.ascendancyId });
      if (asc !== undefined && (asc.entity as Ascendancy).classId !== c.classId) {
        findings.push({
          gate: "G1",
          severity: "error",
          code: "ascendancy_class_mismatch",
          message: "The ascendancy does not belong to the chosen class in this data release.",
          path: "/ascendancyId",
          entity: { kind: "ascendancy", id: c.ascendancyId },
        });
      }
      findings.push(...rejectedFindings(checkCtx, refsOf(c)));
      return findings;
    },
  });
}
