import { z } from "zod";
import type {
  ArchetypeCandidate,
  Finding,
  RichText,
  TargetBuild,
} from "@astrolabe/contracts/build";
import {
  GuideAtlas,
  GuideFaqEntry,
  GuideMechanics,
  GuidePlaystyle,
  GuideSummary,
  GuideVariant,
} from "@astrolabe/contracts/guide";
import type { EntityRef, JsonValue } from "@astrolabe/contracts/common";
import type { StageConfig } from "../config.js";
import { defineTask, type AnyTaskSpec, type PipelineContext } from "../pipeline.js";
import { S9_SECTION } from "../prompts.js";
import { requestContext } from "./context.js";

/** The sections Claude writes, in the order of the guide; the rest of the document is assembled by the app. */
export const S9_SECTIONS = [
  "summary",
  "mechanics",
  "playstyle",
  "atlas",
  "variants",
  "faq",
] as const;
export type S9Section = (typeof S9_SECTIONS)[number];

export const sectionKey = (s: S9Section): string => `S9.${s}`;

/** Summary part Claude writes; class, ascendancy, skill and budget range come from the plans. */
export const SummaryDraft = GuideSummary.omit({
  classId: true,
  ascendancyId: true,
  mainSkillId: true,
  budgetRange: true,
});
export type SummaryDraft = z.infer<typeof SummaryDraft>;

const VariantsDraft = z.object({ variants: z.array(GuideVariant) });
const FaqDraft = z.object({ faq: z.array(GuideFaqEntry).min(1) });

export const sectionSchemas = {
  summary: SummaryDraft,
  mechanics: GuideMechanics,
  playstyle: GuidePlaystyle,
  atlas: GuideAtlas,
  variants: VariantsDraft,
  faq: FaqDraft,
} as const satisfies Record<S9Section, z.ZodType>;

const SEGMENT_TYPES = new Set(["text", "calc", "entity"]);

function isRichText(v: unknown): v is RichText {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (s) =>
        typeof s === "object" &&
        s !== null &&
        SEGMENT_TYPES.has((s as { type?: unknown }).type as string),
    )
  );
}

const isRef = (v: unknown): v is EntityRef =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as { kind?: unknown }).kind === "string" &&
  typeof (v as { id?: unknown }).id === "string";

/** All rich text and catalog references of a section payload, with JSON pointers. */
export function walkSection(payload: unknown): {
  texts: { path: string; text: RichText }[];
  entities: { path: string; ref: EntityRef }[];
} {
  const texts: { path: string; text: RichText }[] = [];
  const entities: { path: string; ref: EntityRef }[] = [];
  const walk = (v: unknown, path: string): void => {
    if (isRichText(v)) {
      texts.push({ path, text: v });
      v.forEach((seg, i) => {
        if (seg.type === "entity") entities.push({ path: `${path}/${i}/ref`, ref: seg.ref });
      });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}/${i}`));
      return;
    }
    if (typeof v !== "object" || v === null) return;
    for (const [k, x] of Object.entries(v)) {
      if ((k === "subject" || k === "replaces") && isRef(x)) {
        entities.push({ path: `${path}/${k}`, ref: x });
      } else if (k === "with" && Array.isArray(x)) {
        x.forEach((r, i) => {
          if (isRef(r)) entities.push({ path: `${path}/with/${i}`, ref: r });
        });
      } else if (k === "modId" && typeof x === "string") {
        entities.push({ path: `${path}/modId`, ref: { kind: "mod", id: x } as EntityRef });
      } else walk(x, `${path}/${k}`);
    }
  };
  walk(payload, "");
  return { texts, entities };
}

/** The measurements a section may cite: calc ids of the target build per profile. */
export function citableCalcs(target: TargetBuild): JsonValue {
  return Object.entries(target.calcs).flatMap(([profile, outcome]) =>
    outcome.status === "ok" ? [{ profile, calcId: outcome.calcId }] : [],
  ) as JsonValue;
}

export interface S9Inputs {
  chosen: ArchetypeCandidate;
  target: TargetBuild;
  /** Stored plans of S6 to S8, as JSON for the prompt. */
  plans: { progression: JsonValue; gear: JsonValue; crafting: JsonValue };
}

/** The suitability must cover the mode the player asked for. */
async function summaryCheck(payload: unknown, ctx: PipelineContext): Promise<Finding[]> {
  const { suitability } = payload as SummaryDraft;
  const mode = ctx.run.request.mode;
  const wrong = [
    ...(mode.ssf && !suitability.ssf ? ["solo self-found"] : []),
    ...(mode.hardcore && !suitability.hardcore ? ["hardcore"] : []),
    ...(!mode.hardcore && !suitability.softcore ? ["softcore"] : []),
  ];
  return wrong.map((m) => ({
    gate: "G7" as const,
    severity: "error" as const,
    code: "suitability_contradicts_request",
    message: `The player asked for ${m} play, so the guide must be suitable for it.`,
    path: "/suitability",
  }));
}

/** One section of the guide (Claude); earlier sections are context for the later ones. */
export function sectionTask(
  ctx: PipelineContext,
  config: StageConfig,
  section: S9Section,
  inputs: S9Inputs,
): AnyTaskSpec {
  const written = S9_SECTIONS.slice(0, S9_SECTIONS.indexOf(section)).map((s) => {
    const content = ctx.result(sectionKey(s));
    if (content === undefined) throw new Error(`Section ${s} is missing before ${section}`);
    return { section: s, content };
  });
  return defineTask<unknown>({
    key: sectionKey(section),
    type: sectionKey(section),
    promptVersion: config.promptVersion,
    instructions: `${S9_SECTION} Section to write: ${section}.`,
    context: {
      request: requestContext(ctx),
      chosen: JSON.parse(JSON.stringify(inputs.chosen)) as JsonValue,
      calcs: citableCalcs(inputs.target),
      ...inputs.plans,
      written,
    },
    schema: sectionSchemas[section],
    ...(section === "summary" ? { check: summaryCheck } : {}),
    allowedTools: ["catalog_search", "catalog_get", "calc_evaluate"],
    entities: (p) => walkSection(p).entities,
    richText: (p) => walkSection(p).texts,
  });
}
