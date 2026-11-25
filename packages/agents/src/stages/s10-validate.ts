import { z } from "zod";
import {
  type ArchetypeCandidate,
  type CraftingPlan,
  CraftingPlan as CraftingPlanSchema,
  type Finding,
  GearPlan,
  ProgressionPlan,
  type TargetBuild,
} from "@astrolabe/contracts/build";
import { GuideDocument } from "@astrolabe/contracts/guide";
import { EntityKind, type EntityRef, type JsonValue } from "@astrolabe/contracts/common";
import type { PipelineContext, PlanStep } from "../pipeline.js";
import { craftKey } from "./s8-craft.js";
import { itemEntities } from "./s7-gear.js";
import { type S9Section, sectionKey, type SummaryDraft, walkSection } from "./s9-guide.js";

export const S10_REPORT_KEY = "S10.report";

/** The guide as assembled by the app; metadata and the final report are added at publishing (S11). */
export const GuideDraft = GuideDocument.omit({ metadata: true, validation: true });
export type GuideDraft = z.infer<typeof GuideDraft>;

export interface S10Inputs {
  chosen: ArchetypeCandidate;
  target: TargetBuild;
  /** The skill the run settled on: the player's pick or the S0 choice. */
  mainSkillId: string;
}

/** Puts the stored plans and the written sections together; a string names what is wrong. */
export function assembleDraft(ctx: PipelineContext, inputs: S10Inputs): GuideDraft | string {
  const section = (s: S9Section): unknown => ctx.result(sectionKey(s));
  const progression = ProgressionPlan.safeParse(ctx.result("S6.plan"));
  const gear = GearPlan.safeParse(ctx.result("S7.plan"));
  const crafting = z
    .object({ plans: z.array(CraftingPlanSchema) })
    .safeParse(ctx.result("S8.plan"));
  if (!progression.success) return "The stored progression plan (S6) is unreadable.";
  if (!gear.success) return "The stored gear plan (S7) is unreadable.";
  if (!crafting.success) return "The stored crafting plans (S8) are unreadable.";
  const request = ctx.run.request;
  // The gear plan points to the crafting plan of each crafted rare of the last tier.
  const linked: GearPlan = {
    tiers: gear.data.tiers.map((t, i) => ({
      ...t,
      slots: t.slots.map((s) =>
        i === gear.data.tiers.length - 1 && s.acquisition === "craft" && s.target.kind === "crafted"
          ? { ...s, craftingPlanKey: craftKey(s.slot) }
          : s,
      ),
    })),
  };
  const summaryDraft = section("summary") as SummaryDraft | undefined;
  if (summaryDraft === undefined) return "The summary section is missing.";
  const candidate = inputs.chosen;
  const draft = {
    request,
    summary: {
      ...summaryDraft,
      classId: candidate.classId,
      ascendancyId: candidate.ascendancyId,
      mainSkillId: inputs.mainSkillId,
      budgetRange: { from: request.budget.leveling, to: request.budget.endgame },
    },
    mechanics: section("mechanics"),
    progression: progression.data,
    gear: linked,
    crafting: crafting.data.plans,
    playstyle: section("playstyle"),
    atlas: section("atlas"),
    variants: (section("variants") as { variants?: unknown } | undefined)?.variants,
    faq: (section("faq") as { faq?: unknown } | undefined)?.faq,
  };
  const parsed = GuideDraft.safeParse(draft);
  return parsed.success
    ? parsed.data
    : `The guide does not fit the document contract: ${parsed.error.message}`;
}

/** Every catalog reference in the draft, with a JSON pointer. */
export function draftEntities(draft: GuideDraft): { path: string; ref: EntityRef }[] {
  const kinds = new Set<string>(EntityKind.options);
  const out: { path: string; ref: EntityRef }[] = [];
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}/${i}`));
    if (typeof v !== "object" || v === null) return;
    const o = v as Record<string, unknown>;
    if (typeof o.kind === "string" && kinds.has(o.kind) && typeof o.id === "string") {
      out.push({ path, ref: { kind: o.kind, id: o.id } as EntityRef });
      return;
    }
    for (const [k, x] of Object.entries(o)) walk(x, `${path}/${k}`);
  };
  walk(draft.progression, "/progression");
  walk(draft.crafting, "/crafting");
  draft.gear.tiers.forEach((t, i) =>
    t.slots.forEach((s, j) => {
      for (const item of [s.target, s.minimum, ...s.alternatives]) {
        if (item === undefined) continue;
        for (const e of itemEntities(item)) {
          out.push({ path: `/gear/tiers/${i}/slots/${j}${e.path}`, ref: e.ref });
        }
      }
    }),
  );
  const prose = {
    mechanics: draft.mechanics,
    playstyle: draft.playstyle,
    atlas: draft.atlas,
    variants: draft.variants,
    faq: draft.faq,
    summary: draft.summary,
  };
  for (const e of walkSection(prose).entities) out.push(e);
  return out;
}

const finding = (
  gate: Finding["gate"],
  code: string,
  message: string,
  path?: string,
  returnTo?: string,
): Finding =>
  ({
    gate,
    severity: "error",
    code,
    message,
    ...(path === undefined ? {} : { path }),
    ...(returnTo === undefined ? {} : { returnTo }),
  }) as Finding;

/** Gates that need thresholds or a critic are not built yet; they fail visibly instead of passing. */
const NOT_BUILT = ["G3", "G4", "G5", "G8"] as const;

export interface GateReport {
  gate: Finding["gate"];
  passed: boolean;
  findings: Finding[];
}

/** Runs the deterministic gates over the draft. */
export function runGates(ctx: PipelineContext, draft: GuideDraft): GateReport[] {
  const g1 = draftEntities(draft)
    .filter((e) => ctx.catalog.get(e.ref) === undefined)
    .map((e) =>
      finding(
        "G1",
        "unknown_entity",
        `${e.ref.kind} ${e.ref.id} is not in data release ${ctx.catalog.dataReleaseId}.`,
        e.path,
      ),
    );
  const failedCalc = (record: Record<string, { status: string }>, path: string): Finding[] =>
    Object.entries(record)
      .filter(([, o]) => o.status !== "ok")
      .map(([profile]) =>
        finding("G2", "calc_failed", `The calculation of profile ${profile} failed.`, path),
      );
  const g2 = draft.progression.stages.flatMap((s, i) =>
    failedCalc(s.calcs, `/progression/stages/${i}/calcs`),
  );
  const g6 = draft.progression.stages.flatMap((s, i) =>
    s.respecs.length > 0 && s.respecCost === undefined
      ? [
          finding(
            "G6",
            "respec_cost_missing",
            `Stage ${s.key} respecs passives but states no respec cost.`,
            `/progression/stages/${i}/respecCost`,
            "S6",
          ),
        ]
      : [],
  );
  const crafted = draft.gear.tiers
    .at(-1)
    ?.slots.filter((s) => s.acquisition === "craft" && s.target.kind === "crafted");
  const planned = new Set<string>(draft.crafting.map((c: CraftingPlan) => c.key));
  const g7 = [
    ...(crafted ?? [])
      .filter((s) => !planned.has(craftKey(s.slot)))
      .map((s) =>
        finding(
          "G7",
          "craft_plan_missing",
          `Rare slot ${s.slot} has no crafting plan.`,
          "/crafting",
          "S8",
        ),
      ),
  ];
  const results: GateReport[] = [
    { gate: "G1", passed: g1.length === 0, findings: g1 },
    { gate: "G2", passed: g2.length === 0, findings: g2 },
    { gate: "G6", passed: g6.length === 0, findings: g6 },
    { gate: "G7", passed: g7.length === 0, findings: g7 },
  ];
  for (const gate of NOT_BUILT) {
    results.push({
      gate,
      passed: false,
      findings: [
        finding(
          gate,
          "gate_not_built",
          `Gate ${gate} is not built yet, so the guide cannot count as validated.`,
        ),
      ],
    });
  }
  return results;
}

/** S10: assembles the guide draft and runs the gates; the report is stored even when gates fail. */
export function validateStep(ctx: PipelineContext, inputs: S10Inputs): PlanStep {
  return {
    kind: "server",
    key: S10_REPORT_KEY,
    type: "S10",
    run: async (runCtx) => {
      const draft = assembleDraft(runCtx, inputs);
      if (typeof draft === "string") throw new Error(draft);
      const gates = runGates(runCtx, draft);
      return JSON.parse(
        JSON.stringify({ passed: gates.every((g) => g.passed), gates }),
      ) as JsonValue;
    },
  };
}
