import { z } from "zod";
import {
  ArchetypeCandidate,
  type ArchetypeEvaluation,
  type BuildState,
  type Finding,
  Rationale,
  SkillSetup,
} from "@exileforge/contracts/build";
import type { EntityRef, JsonValue } from "@exileforge/contracts/common";
import type { Ascendancy } from "@exileforge/contracts/catalog";
import type { PocPipelineConfig } from "../config/forge-config.js";
import {
  defineTask,
  type Pipeline,
  type PipelineContext,
  type PlanStep,
} from "../engine/pipeline.js";

/*
 * Proof-of-concept pipeline: proves the forge loop end to end with real
 * contract schemas (S2 candidates → S3 skeleton calcs → S4 user choice →
 * S5 gem setup → S5 calc). The real stage tasks and prompts come from
 * packages/agents; this pipeline only exercises the mechanics.
 */

const READ_TOOLS = ["catalog_search", "catalog_get"];
const CALC_TOOLS = [...READ_TOOLS, "calc_evaluate"];

export const GemSetupSubmission = z.object({
  skills: z.array(SkillSetup).min(1),
  rationale: z.array(Rationale).min(1),
});
export type GemSetupSubmission = z.infer<typeof GemSetupSubmission>;

const candidateKey = (i: number) => `S2.candidate-${i}`;

/** Catalog references in rationale subjects (G1 must see them too). */
const subjects = (rationale: readonly Rationale[], base: string) =>
  rationale.flatMap((r, i) =>
    r.subject === undefined ? [] : [{ path: `${base}/${i}/subject`, ref: r.subject }],
  );

const DIGIT = /\p{Nd}/u;

export function createPocPipeline(config: PocPipelineConfig): Pipeline {
  const candidatesOf = (ctx: PipelineContext): ArchetypeCandidate[] => {
    const list: ArchetypeCandidate[] = [];
    for (let i = 1; i <= config.candidateCount; i += 1) {
      const value = ctx.result(candidateKey(i));
      if (value !== undefined) list.push(ArchetypeCandidate.parse(value));
    }
    return list;
  };

  const skeleton = (ctx: PipelineContext, c: ArchetypeCandidate): BuildState => {
    const main = ctx.run.request.mainSkillId;
    return {
      classId: c.classId,
      ascendancyId: c.ascendancyId,
      level: config.skeletonLevel,
      tree: { allocated: [], ascendancy: [] },
      skills:
        main === undefined
          ? []
          : [
              {
                key: "main",
                role: "main",
                gem: { gemId: main, level: config.skeletonGemLevel, quality: 0 },
                supports: [],
              },
            ],
      items: [],
      config: {},
    };
  };

  const userEntities = (ctx: PipelineContext) => ({
    locked: ctx.run.interventions.flatMap((e) =>
      e.intervention.kind === "lock" ? [e.intervention.entity] : [],
    ),
    rejected: [
      ...ctx.run.request.exclusions,
      ...ctx.run.interventions.flatMap((e) =>
        e.intervention.kind === "reject" ? [e.intervention.entity] : [],
      ),
    ],
  });

  const rejectedFindings = (
    ctx: PipelineContext,
    refs: { path: string; ref: EntityRef }[],
  ): Finding[] => {
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
  };

  const requestContext = (ctx: PipelineContext): JsonValue => {
    const r = ctx.run.request;
    return {
      dataReleaseId: r.dataReleaseId,
      skillIdea: r.skillIdea,
      mainSkillId: r.mainSkillId ?? null,
      mode: r.mode,
      budget: r.budget,
      preferences: r.preferences,
      notes: r.notes ?? null,
    };
  };

  const candidateTask = (ctx: PipelineContext, index: number, previous: ArchetypeCandidate[]) =>
    defineTask<ArchetypeCandidate>({
      key: candidateKey(index),
      type: "S2.candidate",
      promptVersion: config.promptVersion,
      instructions: [
        `Propose build archetype ${index} of ${config.candidateCount} for the player's skill idea.`,
        "It must differ clearly from the previous candidates (other class, ascendancy or damage route).",
        "Use only ids found with catalog_search/catalog_get; never ids from memory.",
        "Text fields are rich text segments; do not type numbers, reference calculations instead.",
      ].join(" "),
      context: {
        request: requestContext(ctx),
        previousCandidates: previous.map((c) => ({
          key: c.key,
          title: c.title,
          classId: c.classId,
          ascendancyId: c.ascendancyId,
        })),
        ...userEntities(ctx),
      },
      schema: ArchetypeCandidate,
      allowedTools: READ_TOOLS,
      entities: (c) => [
        { path: "/classId", ref: { kind: "characterClass", id: c.classId } },
        { path: "/ascendancyId", ref: { kind: "ascendancy", id: c.ascendancyId } },
        ...c.keyEntities.map((ref, i) => ({ path: `/keyEntities/${i}`, ref })),
      ],
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
        if (previous.some((p) => p.key === c.key)) {
          findings.push({
            gate: "schema",
            severity: "error",
            code: "duplicate_key",
            message: `Candidate key ${JSON.stringify(c.key)} is already used. Pick a new key.`,
            path: "/key",
          });
        }
        const asc = checkCtx.catalog.get({ kind: "ascendancy", id: c.ascendancyId });
        if ((asc?.entity as Ascendancy | undefined)?.classId !== c.classId) {
          findings.push({
            gate: "G1",
            severity: "error",
            code: "ascendancy_class_mismatch",
            message: "The ascendancy does not belong to the chosen class in this data release.",
            path: "/ascendancyId",
            entity: { kind: "ascendancy", id: c.ascendancyId },
          });
        }
        findings.push(
          ...rejectedFindings(checkCtx, [
            { path: "/classId", ref: { kind: "characterClass", id: c.classId } },
            { path: "/ascendancyId", ref: { kind: "ascendancy", id: c.ascendancyId } },
            ...c.keyEntities.map((ref, i) => ({ path: `/keyEntities/${i}`, ref })),
          ]),
        );
        return findings;
      },
    });

  const gemTask = (ctx: PipelineContext, chosen: ArchetypeCandidate, evaluation: JsonValue) =>
    defineTask<GemSetupSubmission>({
      key: `S5.gems:${chosen.key}`,
      type: "S5.gems",
      promptVersion: config.promptVersion,
      instructions: [
        "Choose the skill gem setup for the chosen archetype: exactly one setup with role main plus any secondary setups, each with supports.",
        ctx.run.request.mainSkillId === undefined
          ? "Pick the main skill that best fits the player's idea."
          : "The main setup must use the player's main skill.",
        "Use calc_evaluate (with the runId) to compare setups before you submit; explain each choice in rationale without typing numbers.",
      ].join(" "),
      context: { request: requestContext(ctx), chosen, skeletonEvaluation: evaluation },
      schema: GemSetupSubmission,
      allowedTools: CALC_TOOLS,
      entities: (s) => [
        ...s.skills.flatMap((setup, i) => [
          { path: `/skills/${i}/gem/gemId`, ref: { kind: "gem" as const, id: setup.gem.gemId } },
          ...setup.supports.map((g, j) => ({
            path: `/skills/${i}/supports/${j}/gemId`,
            ref: { kind: "gem" as const, id: g.gemId },
          })),
        ]),
        ...subjects(s.rationale, "/rationale"),
      ],
      richText: (s) =>
        s.rationale.map((r, i) => ({ path: `/rationale/${i}/reason`, text: r.reason })),
      check: async (s, checkCtx) => {
        const findings: Finding[] = [];
        const mains = s.skills.filter((x) => x.role === "main");
        if (mains.length !== 1) {
          findings.push({
            gate: "G3",
            severity: "error",
            code: "main_skill_count",
            message: "Exactly one setup must have role main.",
            path: "/skills",
          });
        }
        const wanted = checkCtx.run.request.mainSkillId;
        if (wanted !== undefined && mains[0] !== undefined && mains[0].gem.gemId !== wanted) {
          findings.push({
            gate: "G3",
            severity: "error",
            code: "main_skill_mismatch",
            message: "The main setup must use the player's main skill.",
            path: `/skills/${s.skills.indexOf(mains[0])}/gem/gemId`,
            entity: { kind: "gem", id: wanted },
          });
        }
        findings.push(
          ...rejectedFindings(
            checkCtx,
            s.skills.flatMap((x, i) => [
              { path: `/skills/${i}/gem/gemId`, ref: { kind: "gem" as const, id: x.gem.gemId } },
              ...x.supports.map((g, j) => ({
                path: `/skills/${i}/supports/${j}/gemId`,
                ref: { kind: "gem" as const, id: g.gemId },
              })),
            ]),
          ),
        );
        if (findings.length > 0) return findings;
        const outcomes = await checkCtx.calc.calculate({
          state: { ...skeleton(checkCtx, chosen), skills: s.skills },
          profiles: config.calcProfiles,
        });
        for (const [profile, outcome] of Object.entries(outcomes)) {
          if (outcome.status === "failed") {
            findings.push({
              gate: "G2",
              severity: "error",
              code: "calc_failed",
              message: `The engine could not calculate this setup (profile ${profile}): ${outcome.error.message}`,
              path: "/skills",
            });
          }
        }
        return findings;
      },
    });

  return {
    id: "poc",
    plannedTasks: () => config.candidateCount + 1,
    validateIntervention: (intervention, ctx) => {
      if (intervention.kind !== "chooseVariant") return undefined;
      const keys = candidatesOf(ctx).map((c) => c.key);
      return keys.includes(intervention.candidateKey)
        ? undefined
        : `Unknown variant ${intervention.candidateKey}`;
    },
    plan: (ctx): PlanStep => {
      const candidates = candidatesOf(ctx);
      if (candidates.length < config.candidateCount) {
        return { kind: "task", spec: candidateTask(ctx, candidates.length + 1, candidates) };
      }

      const s3Key = `S3.evaluate:${candidates.map((c) => c.key).join(",")}`;
      const evaluations = ctx.result(s3Key);
      if (evaluations === undefined) {
        return {
          kind: "server",
          key: s3Key,
          type: "S3.evaluate",
          run: async (runCtx) => {
            const list: ArchetypeEvaluation[] = [];
            for (const c of candidates) {
              const state = skeleton(runCtx, c);
              list.push({
                candidateKey: c.key,
                skeleton: state,
                calcs: await runCtx.calc.calculate({ state, profiles: config.calcProfiles }),
              });
            }
            return JSON.parse(JSON.stringify(list)) as JsonValue;
          },
        };
      }

      const choice = ctx.latest("chooseVariant");
      const chosen = candidates.find((c) => c.key === choice?.candidateKey);
      if (chosen === undefined) {
        return {
          kind: "wait_user",
          reason: [
            {
              type: "text",
              text: "The candidates are calculated. The user now picks one variant in the ExileForge app. Call forge_next again.",
            },
          ],
        };
      }

      const gemsKey = `S5.gems:${chosen.key}`;
      const gems = ctx.result(gemsKey);
      if (gems === undefined) {
        const evaluation = Array.isArray(evaluations)
          ? (evaluations.find(
              (e) =>
                typeof e === "object" &&
                e !== null &&
                !Array.isArray(e) &&
                e["candidateKey"] === chosen.key,
            ) ?? null)
          : null;
        return { kind: "task", spec: gemTask(ctx, chosen, evaluation) };
      }

      const s5CalcKey = `S5.evaluate:${chosen.key}`;
      if (ctx.result(s5CalcKey) === undefined) {
        return {
          kind: "server",
          key: s5CalcKey,
          type: "S5.evaluate",
          run: async (runCtx) => {
            const setup = GemSetupSubmission.parse(gems);
            const state = { ...skeleton(runCtx, chosen), skills: setup.skills };
            const calcs = await runCtx.calc.calculate({ state, profiles: config.calcProfiles });
            return JSON.parse(JSON.stringify({ state, calcs })) as JsonValue;
          },
        };
      }
      return { kind: "done" };
    },
  };
}
