import { z } from "zod";

/** config/crafting/sim.json */
export const CraftSimConfig = z
  .object({
    $comment: z.string().optional(),
    version: z.string().min(1),
    defaultRuns: z.int().positive(),
    maxRuns: z.int().positive(),
    defaultSeed: z.int(),
    /** Guards against strategies that never end; hitting it is reported as failure, not hidden. */
    maxStepExecutionsPerAttempt: z.int().positive(),
    /** Older price books give uncalibrated costs. */
    maxPriceBookAgeMinutes: z.int().positive(),
  })
  .refine((c) => c.defaultRuns <= c.maxRuns, { message: "defaultRuns must be <= maxRuns" });
export type CraftSimConfig = z.infer<typeof CraftSimConfig>;

export function parseCraftSimConfig(raw: unknown): CraftSimConfig {
  return CraftSimConfig.parse(raw);
}
