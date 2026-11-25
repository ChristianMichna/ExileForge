import { z } from "zod";

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
  s2: z.object({
    /** Number of archetype candidates (the plan asks for 3–6). */
    candidateCount: z.int().min(1).max(6),
    maxKeyEntities: z.int().positive(),
  }),
});
export type StageConfig = z.infer<typeof StageConfig>;
