import { z } from "zod";
import { BaseItemId, ClassificationId, CraftingActionId, ModId } from "../common/ids.js";
import { DataReleaseId } from "../common/version.js";
import { CraftOnFail, MeasuredChance, MeasuredCount, MeasuredPrice } from "../build/stages.js";
import { EconomyLeague } from "../economy/price.js";

/*
 * Crafting simulator contract (F-15). The simulator is deterministic code in
 * packages/crafting-sim: Monte Carlo over declarative CraftingAction rules
 * from the data release, with a fixed seed. Chances and attempt counts are
 * `derived` (Monte Carlo) from `gamedata` (mod weights); costs are `derived`
 * from those and `market` prices. Where the release has no rule or no spawn
 * weights for something the strategy needs, the result is "uncalibrated"
 * with the reason, never an invented number.
 */

/** Item state during a simulation. Mod values are not modelled, only which mods are on the item. */
export const CraftItemState = z.object({
  baseItemId: BaseItemId,
  itemLevel: z.int().positive(),
  /** Rarity id from the release. */
  rarity: ClassificationId,
  modIds: z.array(ModId),
  /** Flags such as "corrupted" – ids defined by the release's action rules. */
  flags: z.array(ClassificationId).default([]),
});
export type CraftItemState = z.infer<typeof CraftItemState>;

/** All clauses must hold; a clause holds if the item has any of its mods. */
export const CraftGoal = z.object({
  clauses: z.array(z.object({ anyOfModIds: z.array(ModId).min(1) })).min(1),
});
export type CraftGoal = z.infer<typeof CraftGoal>;

/**
 * One step: apply the actions in order, then check `until` (absent = always
 * passes). Passing continues with the next step; failing follows `onFail`.
 * After the last step the goal of the request decides success.
 */
export const CraftStrategyStep = z.object({
  order: z.int().nonnegative(),
  actionIds: z.array(CraftingActionId).min(1),
  until: CraftGoal.optional(),
  onFail: CraftOnFail,
});
export type CraftStrategyStep = z.infer<typeof CraftStrategyStep>;

export const CraftStrategy = z
  .object({ steps: z.array(CraftStrategyStep).min(1) })
  .superRefine((s, ctx) => {
    const orders = new Set<number>();
    s.steps.forEach((step, i) => {
      if (orders.has(step.order)) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "order"], message: "duplicate order" });
      }
      orders.add(step.order);
    });
    s.steps.forEach((step, i) => {
      if (step.onFail.action === "goto" && !orders.has(step.onFail.order)) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "onFail", "order"],
          message: "goto target does not exist",
        });
      }
    });
  });
export type CraftStrategy = z.infer<typeof CraftStrategy>;

export const CraftSimRequest = z.object({
  dataReleaseId: DataReleaseId,
  start: CraftItemState,
  /** Price of the start item; the market has no feed for rares, so the caller derives it. */
  startCost: MeasuredPrice.optional(),
  strategy: CraftStrategy,
  goal: CraftGoal,
  /** Absent = default from config/crafting. Capped by config. */
  runs: z.int().positive().optional(),
  /** Absent = default seed from config/crafting; the result states the seed used. */
  seed: z.int().optional(),
  /** Prices are taken from this league; absent = current league from the economy config. */
  league: EconomyLeague.optional(),
  /** Currency item the costs are given in; absent = no costs, only attempts and consumption. */
  costCurrencyItemId: BaseItemId.optional(),
});
export type CraftSimRequest = z.infer<typeof CraftSimRequest>;

export const CraftActionUse = z.object({
  actionId: CraftingActionId,
  /** Average uses per finished item (successful or not). */
  perAttempt: MeasuredCount,
  /** Average uses until one success. */
  perSuccess: MeasuredCount,
});
export type CraftActionUse = z.infer<typeof CraftActionUse>;

export const CraftStepStat = z.object({
  order: z.int().nonnegative(),
  /** Share of attempts that reached this step. */
  reached: MeasuredChance,
  /** Share of step executions that passed the step's check. */
  passed: MeasuredChance,
});
export type CraftStepStat = z.infer<typeof CraftStepStat>;

export const CraftSimResult = z.object({
  dataReleaseId: DataReleaseId,
  runs: z.int().positive(),
  seed: z.int(),
  /** Share of attempts (start item to end of strategy) that satisfy the goal. */
  successChance: MeasuredChance,
  /** 95 % interval of successChance (Wilson); absent when successChance is not ok. */
  successInterval: z
    .object({ low: z.number().min(0).max(1), high: z.number().min(0).max(1) })
    .optional(),
  /** Attempts until one success; uncalibrated if no run succeeded. */
  expectedAttempts: MeasuredCount,
  actions: z.array(CraftActionUse),
  steps: z.array(CraftStepStat),
  /** Cost until one success: start cost plus action prices, over all attempts. */
  expectedCost: MeasuredPrice,
});
export type CraftSimResult = z.infer<typeof CraftSimResult>;

export const CraftTools = {
  "craft.simulate": {
    description:
      "Monte Carlo simulation of a crafting strategy on the data release's action rules and mod weights: success chance, expected attempts, consumption and cost. Uncalibrated where the release lacks data.",
    input: CraftSimRequest,
    output: CraftSimResult,
  },
} as const;
export type CraftToolName = keyof typeof CraftTools;
