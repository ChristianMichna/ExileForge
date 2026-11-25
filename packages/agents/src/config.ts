import { z } from "zod";
import { BudgetTierId } from "@astrolabe/contracts/build";
import { CalcProfileId } from "@astrolabe/contracts/common";

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
    /** Passive points of the skeleton's tree: a deliberately small design budget of the quick evaluation, not the game's rule (S5 reads that from the release). */
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
  /**
   * S5 target build. Optional on purpose: calc profiles and the tree objective
   * are a product decision that is not made yet. Level and passive points come
   * from the data release, never from here. Without this block the run stops
   * at S5 with an explicit error.
   */
  s5: z
    .object({
      calcProfiles: z.array(CalcProfileId).min(1),
      objective: z.object({
        weights: z.record(z.string().min(1), z.number()),
        floors: z.record(z.string().min(1), z.number()).default({}),
      }),
    })
    .optional(),
  /**
   * S6 progression: calc profiles and tree objective. The stage table is
   * derived from the data release (acts, level bands, passive points); an
   * explicit `stages` list overrides that. Without this block the run stops at
   * S6 with an explicit error.
   */
  s6: z
    .object({
      stages: z
        .array(
          z.object({
            key: z.string().regex(/^[a-z][a-z0-9-]*$/),
            label: z.string().min(1).max(120),
            kind: z.enum(["campaign", "endgame"]),
            act: z.int().positive().optional(),
            levelRange: z.tuple([z.int().positive(), z.int().positive()]),
            /** Main-tree points available at the end of this stage. */
            passivePoints: z.int().nonnegative(),
          }),
        )
        .min(1)
        .superRefine((stages, ctx) => {
          const keys = new Set<string>();
          stages.forEach((st, i) => {
            if (keys.has(st.key)) {
              ctx.addIssue({
                code: "custom",
                message: `duplicate stage key ${st.key}`,
                path: [i, "key"],
              });
            }
            keys.add(st.key);
            if (st.levelRange[0] > st.levelRange[1]) {
              ctx.addIssue({
                code: "custom",
                message: "levelRange must be ascending",
                path: [i, "levelRange"],
              });
            }
            const prev = stages[i - 1];
            if (prev !== undefined && st.passivePoints < prev.passivePoints) {
              ctx.addIssue({
                code: "custom",
                message: "passivePoints must not decrease",
                path: [i, "passivePoints"],
              });
            }
            if (prev !== undefined && st.levelRange[0] <= prev.levelRange[1]) {
              ctx.addIssue({
                code: "custom",
                message: "level bands must not overlap",
                path: [i, "levelRange"],
              });
            }
          });
        })
        .optional(),
      calcProfiles: z.array(CalcProfileId).min(1),
      objective: z.object({
        weights: z.record(z.string().min(1), z.number()),
        floors: z.record(z.string().min(1), z.number()).default({}),
      }),
    })
    .optional(),
  /**
   * S7 gear. Optional on purpose, like s5 and s6: the item slots come from the
   * release (PoB slot ids and the classes each accepts), the budget tiers are
   * an editable default that the product owner adjusts. Without this block the run stops at S7 with an
   * explicit error.
   */
  s7: z
    .object({
      /**
       * Overrides the slots of the release (`DataRelease.itemSlots`, ids exactly
       * as PoB names them). Without it the release's slots are used.
       */
      slots: z.array(z.string().min(1)).min(1).optional(),
      /** Slots every tier must fill; absent means the release's slots that are neither optional nor dependent. */
      requiredSlots: z.array(z.string().min(1)).optional(),
      /** Budget tiers in ascending order; the request names tiers by id. */
      tiers: z
        .array(z.object({ id: BudgetTierId, label: z.string().min(1).max(120) }))
        .min(1)
        .refine((t) => new Set(t.map((x) => x.id)).size === t.length, {
          message: "duplicate tier id",
        }),
      calcProfiles: z.array(CalcProfileId).min(1),
    })
    .optional(),
  s2: z.object({
    /** Number of archetype candidates (the plan asks for 3–6). */
    candidateCount: z.int().min(1).max(6),
    maxKeyEntities: z.int().positive(),
  }),
});
export type StageConfig = z.infer<typeof StageConfig>;
