import { z } from "zod";
import {
  AscendancyId,
  CharacterClassId,
  ClassificationId,
  EntityRef,
  GemId,
  ModId,
} from "../common/ids.js";
import { DataReleaseId, IsoDateTime, PobVersion } from "../common/version.js";
import { ValidationReport } from "../build/findings.js";
import { BudgetTierId, BuildRequest, Level3 } from "../build/request.js";
import { CraftingPlan, GearPlan, ProgressionPlan } from "../build/stages.js";
import { Rationale, RichText } from "../build/text.js";

/** Version of the GuideDocument layout; bump with a migration. */
export const GUIDE_SCHEMA_VERSION = 1;

/** 1. Build summary ("Steckbrief"). */
export const GuideSummary = z.object({
  classId: CharacterClassId,
  ascendancyId: AscendancyId,
  mainSkillId: GemId,
  damageTypes: z.array(ClassificationId).min(1),
  scalingAxes: RichText,
  defenceLayers: z.array(ClassificationId).min(1),
  playstyle: RichText,
  complexity: Level3,
  strengths: z.array(RichText).min(1),
  weaknesses: z.array(RichText).min(1),
  budgetRange: z.object({ from: BudgetTierId, to: BudgetTierId }),
  suitability: z.object({ softcore: z.boolean(), hardcore: z.boolean(), ssf: z.boolean() }),
});
export type GuideSummary = z.infer<typeof GuideSummary>;

/** 2. How the skill works and why the key choices were made. */
export const GuideMechanics = z.object({
  explanation: RichText,
  decisions: z.array(Rationale).min(1),
});

/** 7. How to play the build. */
export const GuidePlaystyle = z.object({
  rotation: RichText,
  keybinds: RichText.optional(),
  mapping: RichText,
  bossing: RichText,
  positioning: RichText,
  bossMechanics: z.array(z.object({ subject: EntityRef.optional(), advice: RichText })),
});

/** 8. Atlas and endgame strategy. */
export const GuideAtlas = z.object({
  strategy: RichText,
  /** Map/waystone mods this build must avoid (catalog ids). */
  avoidMods: z.array(z.object({ modId: ModId, reason: RichText })),
});

/** 9. Alternatives and mode-specific adjustments. */
export const GuideVariant = z.object({
  kind: z.enum(["alternative", "hardcore", "ssf"]),
  replaces: EntityRef.optional(),
  with: z.array(EntityRef).default([]),
  explanation: RichText,
});

/** 10. Troubleshooting entry. */
export const GuideFaqEntry = z.object({
  question: RichText,
  answer: RichText,
  checklist: z.array(RichText).default([]),
});

/** 11. Metadata: where every part came from. */
export const GuideMetadata = z.object({
  guideId: z.uuid(),
  revision: z.int().nonnegative(),
  schemaVersion: z.literal(GUIDE_SCHEMA_VERSION),
  dataReleaseId: DataReleaseId,
  pobVersion: PobVersion,
  generatedAt: IsoDateTime,
  /** Model per pipeline task class, as reported by the client or gateway. */
  models: z.array(z.object({ taskClass: z.string().min(1), model: z.string().min(1) })),
  promptVersions: z.record(z.string().min(1), z.string().min(1)),
  seeds: z.record(z.string().min(1), z.int()).default({}),
});
export type GuideMetadata = z.infer<typeof GuideMetadata>;

/**
 * The guide as structured document (S9) with the 11 mandatory parts of the
 * plan. Prose is a layer on top: RichText with calc and entity references.
 * Completeness (G7) and minimum counts beyond "not empty" are checked by the
 * gates with values from config/, not by this schema.
 */
export const GuideDocument = z.object({
  metadata: GuideMetadata,
  request: BuildRequest,
  summary: GuideSummary,
  mechanics: GuideMechanics,
  progression: ProgressionPlan,
  gear: GearPlan,
  crafting: z.array(CraftingPlan),
  playstyle: GuidePlaystyle,
  atlas: GuideAtlas,
  variants: z.array(GuideVariant),
  faq: z.array(GuideFaqEntry),
  validation: ValidationReport.optional(),
});
export type GuideDocument = z.infer<typeof GuideDocument>;
