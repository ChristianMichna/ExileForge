import { z } from "zod";
import {
  type ArchetypeCandidate,
  type BuildState,
  type CraftingPlan,
  CraftingPlan as CraftingPlanSchema,
  Finding,
  GateResult,
  GearPlan,
  ProgressionPlan,
  type TargetBuild,
} from "@astrolabe/contracts/build";
import { GuideDocument } from "@astrolabe/contracts/guide";
import type { EntityRef, JsonValue } from "@astrolabe/contracts/common";
import type { PipelineContext, PlanStep } from "../pipeline.js";
import { craftKey, S8_PLAN_KEY } from "./s8-craft.js";
import { S6_PLAN_KEY } from "./s6-progression.js";
import { S7_PLAN_KEY } from "./s7-plan.js";
import { itemEntities } from "./s7-gear.js";
import { type S9Section, sectionKey, sectionSchemas, walkSection } from "./s9-guide.js";

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

/** Parses a stored result; the error names the part and keeps the schema error as cause. */
function stored<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`The stored ${what} is unreadable. Redo the stage that wrote it.`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** Puts the stored plans and the written sections together; throws with the cause if a part is unreadable. */
export function assembleDraft(ctx: PipelineContext, inputs: S10Inputs): GuideDraft {
  const part = <K extends S9Section>(
    k: K,
    schema: z.ZodType<z.infer<(typeof sectionSchemas)[K]>>,
  ) => stored(schema, ctx.result(sectionKey(k)), `${k} section (S9)`);
  const progression = stored(ProgressionPlan, ctx.result(S6_PLAN_KEY), "progression plan (S6)");
  const gear = stored(GearPlan, ctx.result(S7_PLAN_KEY), "gear plan (S7)");
  const crafting = stored(
    z.object({ plans: z.array(CraftingPlanSchema) }),
    ctx.result(S8_PLAN_KEY),
    "crafting plans (S8)",
  ).plans;
  const request = ctx.run.request;
  const planned = new Set(crafting.map((c) => c.key));
  // The gear plan points to the crafting plan of each crafted rare of the last tier that has one.
  const linked: GearPlan = {
    tiers: gear.tiers.map((t, i) => ({
      ...t,
      slots: t.slots.map((sl) =>
        i === gear.tiers.length - 1 &&
        sl.acquisition === "craft" &&
        sl.target.kind === "crafted" &&
        planned.has(craftKey(sl.slot))
          ? { ...sl, craftingPlanKey: craftKey(sl.slot) }
          : sl,
      ),
    })),
  };
  return stored(
    GuideDraft,
    {
      request,
      summary: {
        ...part("summary", sectionSchemas.summary),
        classId: inputs.chosen.classId,
        ascendancyId: inputs.chosen.ascendancyId,
        mainSkillId: inputs.mainSkillId,
        budgetRange: { from: request.budget.leveling, to: request.budget.endgame },
      },
      mechanics: part("mechanics", sectionSchemas.mechanics),
      progression,
      gear: linked,
      crafting,
      playstyle: part("playstyle", sectionSchemas.playstyle),
      atlas: part("atlas", sectionSchemas.atlas),
      variants: part("variants", sectionSchemas.variants).variants,
      faq: part("faq", sectionSchemas.faq).faq,
    },
    "guide draft",
  );
}

type Found = { path: string; ref: EntityRef };

const ref = (kind: EntityRef["kind"], id: string, path: string): Found => ({
  path,
  ref: { kind, id } as EntityRef,
});

function stateEntities(state: BuildState, base: string): Found[] {
  return [
    ref("characterClass", state.classId, `${base}/classId`),
    ...(state.ascendancyId === undefined
      ? []
      : [ref("ascendancy", state.ascendancyId, `${base}/ascendancyId`)]),
    ...state.tree.allocated.map((n, i) =>
      ref("passiveNode", n.nodeId, `${base}/tree/allocated/${i}/nodeId`),
    ),
    ...state.tree.ascendancy.map((n, i) => ref("passiveNode", n, `${base}/tree/ascendancy/${i}`)),
    ...state.skills.flatMap((sk, i) => [
      ref("gem", sk.gem.gemId, `${base}/skills/${i}/gem/gemId`),
      ...sk.supports.map((g, j) => ref("gem", g.gemId, `${base}/skills/${i}/supports/${j}/gemId`)),
    ]),
    ...state.items.flatMap((it, i) =>
      itemEntities(it.item).map((e) => ({ path: `${base}/items/${i}/item${e.path}`, ref: e.ref })),
    ),
  ];
}

/** Currency items named by prices anywhere in a value (`currencyItemId` fields). */
function currencyEntities(value: unknown, path: string): Found[] {
  if (Array.isArray(value)) return value.flatMap((x, i) => currencyEntities(x, `${path}/${i}`));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([k, x]) =>
    k === "currencyItemId" && typeof x === "string"
      ? [ref("baseItem", x, `${path}/${k}`)]
      : currencyEntities(x, `${path}/${k}`),
  );
}

const prefixed = (found: Found[], base: string): Found[] =>
  found.map((e) => ({ path: `${base}${e.path}`, ref: e.ref }));

/** Every catalog reference in the draft, with a JSON pointer. */
export function draftEntities(draft: GuideDraft): Found[] {
  const out: Found[] = [
    ...(draft.request.mainSkillId === undefined
      ? []
      : [ref("gem", draft.request.mainSkillId, "/request/mainSkillId")]),
    ...draft.request.exclusions.map((x, i) => ({ path: `/request/exclusions/${i}`, ref: x })),
    ref("characterClass", draft.summary.classId, "/summary/classId"),
    ref("ascendancy", draft.summary.ascendancyId, "/summary/ascendancyId"),
    ref("gem", draft.summary.mainSkillId, "/summary/mainSkillId"),
  ];
  draft.progression.stages.forEach((st, i) => {
    const base = `/progression/stages/${i}`;
    out.push(
      ...stateEntities(st.state, `${base}/state`),
      ...st.allocationOrder.map((n, j) => ref("passiveNode", n, `${base}/allocationOrder/${j}`)),
      ...st.respecs.map((n, j) => ref("passiveNode", n, `${base}/respecs/${j}`)),
      ...prefixed(
        walkSection({ tasks: st.tasks, dangers: st.dangers, rationale: st.rationale }).entities,
        base,
      ),
    );
  });
  draft.gear.tiers.forEach((t, i) =>
    t.slots.forEach((sl, j) => {
      for (const item of [sl.target, sl.minimum, ...sl.alternatives]) {
        if (item === undefined) continue;
        for (const e of itemEntities(item)) {
          out.push({ path: `/gear/tiers/${i}/slots/${j}${e.path}`, ref: e.ref });
        }
      }
    }),
  );
  draft.crafting.forEach((c, i) => {
    const base = `/crafting/${i}`;
    out.push(
      ...prefixed(itemEntities(c.target), `${base}/target`),
      ref("baseItem", c.start.baseItemId, `${base}/start/baseItemId`),
      ...c.steps.flatMap((st, j) =>
        st.actionIds.map((id, k) => ref("craftingAction", id, `${base}/steps/${j}/actionIds/${k}`)),
      ),
      ...prefixed(walkSection({ steps: c.steps, fallback: c.fallback }).entities, base),
    );
  });
  out.push(
    ...currencyEntities(draft.progression, "/progression"),
    ...currencyEntities(draft.gear, "/gear"),
    ...currencyEntities(draft.crafting, "/crafting"),
    ...walkSection({
      mechanics: draft.mechanics,
      playstyle: draft.playstyle,
      atlas: draft.atlas,
      variants: draft.variants,
      faq: draft.faq,
      summary: {
        scalingAxes: draft.summary.scalingAxes,
        playstyle: draft.summary.playstyle,
        strengths: draft.summary.strengths,
        weaknesses: draft.summary.weaknesses,
      },
    }).entities,
  );
  return out;
}

const finding = (
  gate: Finding["gate"],
  code: string,
  message: string,
  path?: string,
  returnTo?: string,
): Finding =>
  Finding.parse({
    gate,
    severity: "error",
    code,
    message,
    ...(path === undefined ? {} : { path }),
    ...(returnTo === undefined ? {} : { returnTo }),
  });

/** What a gate does not check yet; such a gate cannot pass. */
const NOT_BUILT: Partial<Record<Finding["gate"], string>> = {
  G2: "the required calc profiles of the config and the list of unsupported mods",
  G3: "the whole gate (attributes, level requirements, spirit, point count, tree paths)",
  G4: "the whole gate (resistance caps and EHP thresholds per stage)",
  G5: "the whole gate (damage thresholds per stage)",
  G6: "the continuity of skills between stages (lost gems)",
  G7: "the minimum counts of the guide parts and rares of earlier tiers",
  G8: "the whole gate (consistency of text and data, critic)",
};

/** Runs the deterministic gates over the draft; a gate passes only if everything it covers was checked. */
export function runGates(ctx: PipelineContext, draft: GuideDraft): GateResult[] {
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
  const g2 = draft.progression.stages.flatMap((s, i) => {
    const path = `/progression/stages/${i}/calcs`;
    const outcomes = Object.entries(s.calcs);
    return [
      ...(outcomes.length === 0
        ? [finding("G2", "calc_missing", `Stage ${s.key} has no calculation.`, path, "S6")]
        : []),
      ...outcomes
        .filter(([, o]) => o.status !== "ok")
        .map(([profile]) =>
          finding(
            "G2",
            "calc_failed",
            `Stage ${s.key}: the calculation of ${profile} failed.`,
            path,
            "S6",
          ),
        ),
    ];
  });
  const g6 = draft.progression.stages.flatMap((s, i) =>
    s.respecs.length > 0 && s.respecCost?.status !== "ok"
      ? [
          finding(
            "G6",
            "respec_cost_not_measured",
            `Stage ${s.key} respecs passives but has no measured respec cost.`,
            `/progression/stages/${i}/respecCost`,
            "S6",
          ),
        ]
      : [],
  );
  const planned = new Set<string>(draft.crafting.map((c: CraftingPlan) => c.key));
  const g7 = draft.gear.tiers
    .at(-1)
    ?.slots.filter((s) => s.acquisition === "craft" && s.target.kind === "crafted")
    .filter((s) => !planned.has(craftKey(s.slot)))
    .map((s) =>
      finding(
        "G7",
        "craft_plan_missing",
        `Rare slot ${s.slot} has no crafting plan.`,
        "/crafting",
        "S8",
      ),
    );
  const found: Partial<Record<Finding["gate"], Finding[]>> = {
    G1: g1,
    G2: g2,
    G6: g6,
    G7: g7 ?? [],
  };
  return (["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"] as const).map((gate) => {
    const findings = [...(found[gate] ?? [])];
    const gap = NOT_BUILT[gate];
    if (gap !== undefined) {
      findings.push(
        finding(
          gate,
          "check_not_built",
          `Not checked yet: ${gap}. The gate cannot count as passed.`,
        ),
      );
    }
    return GateResult.parse({ gate, passed: findings.length === 0, findings });
  });
}

/** S10: assembles the guide draft and runs the gates; the draft and report are stored even when gates fail. */
export function validateStep(inputs: S10Inputs): PlanStep {
  return {
    kind: "server",
    key: S10_REPORT_KEY,
    type: "S10",
    run: async (runCtx) => {
      const draft = assembleDraft(runCtx, inputs);
      const gates = runGates(runCtx, draft);
      return JSON.parse(
        JSON.stringify({ passed: gates.every((g) => g.passed), gates, draft }),
      ) as JsonValue;
    },
  };
}
