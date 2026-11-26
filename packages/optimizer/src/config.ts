import { z } from "zod";

/** Search settings; lives versioned in config/optimizer/tree.json. */
export const OptimizerConfig = z.object({
  version: z.string().min(1),
  /** Candidates evaluated per growth round. */
  candidatesPerRound: z.int().positive(),
  /** Longest path (unallocated nodes) to a target node considered in one step. */
  maxPathCost: z.int().positive(),
  /** Share of the candidates per round that have no measured value yet (0 = only measured ones). */
  explorationShare: z.number().min(0).max(1),
  maxRefineRounds: z.int().nonnegative(),
  /** Nodes tried as replacement for each removable leaf. */
  swapAddsPerLeaf: z.int().positive(),
  /** Upper bound of swap candidates evaluated per refine round. */
  maxSwapCandidates: z.int().positive(),
  /** Total PoB evaluations (cache misses) one run may use. */
  maxEvaluations: z.int().positive(),
  /** Smallest normalized score gain that counts as an improvement. */
  minImprovement: z.number().nonnegative(),
  /** Weight of a normalized floor shortfall in the score. */
  floorPenalty: z.number().positive(),
  /** Spend all points even when the best step does not raise the score. */
  spendAllPoints: z.boolean(),
});
export type OptimizerConfig = z.infer<typeof OptimizerConfig>;

export function parseOptimizerConfig(raw: unknown): OptimizerConfig {
  const parsed = OptimizerConfig.safeParse(raw);
  if (!parsed.success) throw new Error("Invalid optimizer config", { cause: parsed.error });
  return parsed.data;
}
