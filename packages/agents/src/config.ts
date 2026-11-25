import { z } from "zod";
import { CalcProfileId } from "@exileforge/contracts/common";

/** Settings of the pipeline stages; lives versioned in config/agents/stages.json. */
export const StageConfig = z.object({
  version: z.string().min(1),
  /** Version of the prompt texts these stages use; reported in the guide metadata. */
  promptVersion: z.string().min(1),
  /**
   * Gem kinds (ids from the data release) that are support gems. Release
   * data, so it lives here and not in code; a patch that renames it only
   * changes this file.
   */
  supportGemKinds: z.array(z.string().min(1)).min(1),
  s1: z.object({
    /** Upper bound per list a profile may contain (keeps tasks small). */
    maxListItems: z.int().positive(),
  }),
  s3: z.object({
    /** Character level of the skeleton build (a design parameter of the quick evaluation). */
    level: z.int().positive(),
    /** Passive points the skeleton's tree may use. */
    passivePoints: z.int().positive(),
    /** Level of the main and support gems in the skeleton. */
    gemLevel: z.int().positive(),
    /** Support gems taken from the profile's candidates, in the profile's order. */
    supportCount: z.int().nonnegative(),
    /** Calc profiles every skeleton is measured with. */
    calcProfiles: z.array(CalcProfileId).min(1),
    /** Tree objective: PoB output names with weights and minimum values. */
    objective: z.object({
      weights: z.record(z.string().min(1), z.number()),
      floors: z.record(z.string().min(1), z.number()).default({}),
    }),
  }),
  s2: z.object({
    /** Number of archetype candidates (the plan asks for 3–6). */
    candidateCount: z.int().min(1).max(6),
    maxKeyEntities: z.int().positive(),
  }),
});
export type StageConfig = z.infer<typeof StageConfig>;
