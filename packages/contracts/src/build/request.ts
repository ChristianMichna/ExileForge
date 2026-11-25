import { z } from "zod";
import { ClassificationId, EntityRef, GemId } from "../common/ids.js";
import { DataReleaseId } from "../common/version.js";
import { ConfigOverrides } from "../calc/rpc.js";

/** Budget tier id from config (e.g. league start, mid, endgame); tiers are not hard-coded. */
export const BudgetTierId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export type BudgetTierId = z.infer<typeof BudgetTierId>;

export const Level3 = z.enum(["low", "medium", "high"]);
export type Level3 = z.infer<typeof Level3>;

/** S0 result: what the player wants. Normalised from the intake form. */
export const BuildRequest = z.object({
  dataReleaseId: DataReleaseId,
  /** Free-text idea as typed by the player; never parsed for numbers. */
  skillIdea: z.string().max(2000),
  /** Main skill if chosen or resolved from the idea (G1: must exist in the release). */
  mainSkillId: GemId.optional(),
  mode: z.object({
    hardcore: z.boolean(),
    ssf: z.boolean(),
  }),
  league: z.string().min(1).optional(),
  budget: z.object({ leveling: BudgetTierId, endgame: BudgetTierId }),
  preferences: z.object({
    /** Play pattern tags from the release (e.g. skill tags); open ids. */
    playstyleTags: z.array(ClassificationId).default([]),
    focus: z.enum(["mapping", "bossing", "allround"]),
    pace: z.enum(["tanky", "balanced", "fast"]),
    complexityTolerance: Level3,
    /** Defence layer ids from the release; empty = no preference. */
    defenceLayers: z.array(ClassificationId).default([]),
  }),
  /**
   * The player's changes to the standard calc profiles (enemy, conditions,
   * buffs) as PoB option names. They apply to every number of the run.
   */
  calcOverrides: ConfigOverrides.default({}),
  /** Entities the player does not want (classes, uniques, skills …). */
  exclusions: z.array(EntityRef).default([]),
  notes: z.string().max(2000).optional(),
});
export type BuildRequest = z.infer<typeof BuildRequest>;
