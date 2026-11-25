import {
  type ArchetypeCandidate,
  type BuildState,
  GearPlan,
  type ItemSpec,
  type TargetBuild,
} from "@astrolabe/contracts/build";
import type { ItemPrice, PricedItemRef } from "@astrolabe/contracts";
import type { CalcId, JsonValue, PrimarySource } from "@astrolabe/contracts/common";

type PobSource = Extract<PrimarySource, { kind: "pob" }>;
import type { PipelineContext, PlanStep } from "../pipeline.js";
import { GearChoice, gearKey, geared, type S7Config } from "./s7-gear.js";

export const S7_PLAN_KEY = "S7.plan";

/** Formula id of the upgrade ranking; bump the version when its arithmetic changes. */
export const GAIN_PER_COST_FORMULA = "gear.gain-per-cost";
export const GAIN_PER_COST_VERSION = "1";

type MeasuredPrice = GearPlan["tiers"][number]["slots"][number]["cost"];

/** The market ref of an item, if it has one; crafted rares are priced by S8. */
function pricedRef(item: ItemSpec): PricedItemRef | undefined {
  return item.kind === "unique" ? { kind: "uniqueItem", id: item.uniqueId } : undefined;
}

const refKey = (r: PricedItemRef): string => `${r.kind}:${r.id}`;

/** S7 part 2: prices and the upgrade order of every tier, measured with PoB and the economy. */
export function planJob(
  ctx: PipelineContext,
  s7: S7Config,
  tiers: readonly { id: string; label: string }[],
  _chosen: ArchetypeCandidate,
  target: TargetBuild,
): PlanStep {
  return {
    kind: "job",
    key: S7_PLAN_KEY,
    type: "S7.plan",
    label: "pricing the gear and ranking upgrades with Path of Building",
    run: async (runCtx) => {
      const profile = s7.calcProfiles[0];
      if (profile === undefined) throw new Error("S7 has no calc profile");
      const choices = tiers.map((tier) => {
        const parsed = GearChoice.safeParse(runCtx.result(gearKey(tier.id)));
        if (!parsed.success) {
          throw new Error(`The stored gear of tier ${tier.id} is unreadable`, {
            cause: parsed.error,
          });
        }
        return { tier, choice: parsed.data };
      });

      // One price call for all unique items of all tiers.
      const refs = new Map<string, PricedItemRef>();
      for (const { choice } of choices) {
        for (const slot of choice.slots) {
          const ref = pricedRef(slot.target);
          if (ref !== undefined) refs.set(refKey(ref), ref);
        }
      }
      const prices = new Map<string, MeasuredPrice>();
      let priceError: { code: string; message: string } | undefined;
      let noService = false;
      if (refs.size > 0) {
        if (runCtx.economy === undefined) {
          noService = true;
        } else {
          try {
            const answer = await runCtx.economy.price({
              ...(runCtx.run.request.league === undefined
                ? {}
                : { league: runCtx.run.request.league }),
              items: [...refs.values()],
            });
            answer.prices.forEach((p: ItemPrice) => prices.set(refKey(p.item), p.price));
          } catch (cause) {
            priceError = {
              code: "price_fetch_failed",
              message: cause instanceof Error ? cause.message : String(cause),
            };
          }
        }
      }
      const priceOf = (item: ItemSpec): MeasuredPrice => {
        const ref = pricedRef(item);
        if (ref === undefined) {
          return {
            status: "uncalibrated",
            reason: "A crafted rare has no market price; its cost comes from the crafting plan.",
          };
        }
        if (priceError !== undefined) return { status: "failed", error: priceError };
        if (noService) {
          return { status: "uncalibrated", reason: "No economy service is configured." };
        }
        return (
          prices.get(refKey(ref)) ?? {
            status: "uncalibrated",
            reason: `The economy service returned no price for ${ref.kind} ${ref.id}.`,
          }
        );
      };

      const measure = async (
        state: BuildState,
      ): Promise<{
        calcId: CalcId;
        stats: Record<string, number>;
        source: PobSource;
      }> => {
        const outcome = (await runCtx.calc.calculate({ state, profiles: [profile] }))[profile];
        if (outcome === undefined || outcome.status === "failed") {
          throw new Error(
            `The engine could not measure the gear (profile ${profile}): ${outcome?.error.message ?? "no result"}`,
          );
        }
        const result = await runCtx.calc.getResult(outcome.calcId);
        if (result === undefined) throw new Error(`Calc result ${outcome.calcId} is not stored`);
        return {
          calcId: outcome.calcId,
          stats: result.stats,
          source: {
            kind: "pob",
            pobVersion: result.pobVersion,
            dataReleaseId: result.dataReleaseId,
            calcProfile: result.calcProfile,
            calcId: outcome.calcId,
          },
        };
      };
      const weights = Object.entries(s7.objective.weights);

      const out = [];
      for (const { tier, choice } of choices) {
        const withAll = await measure(geared(target.state, choice));
        const slots = [];
        const upgrades: {
          slot: string;
          ratio: GearPlan["tiers"][number]["upgradeOrder"][number]["gainPerCost"];
          sort: number;
        }[] = [];
        for (const entry of choice.slots) {
          const cost = priceOf(entry.target);
          slots.push({
            slot: entry.slot,
            priority: entry.priority,
            target: entry.target,
            alternatives: [],
            acquisition: entry.acquisition,
            cost,
          });
          const without = await measure(
            geared(target.state, { slots: choice.slots.filter((s) => s.slot !== entry.slot) }),
          );
          let gain = 0;
          let counted = 0;
          for (const [stat, weight] of weights) {
            const a = withAll.stats[stat];
            const b = without.stats[stat];
            if (a === undefined || b === undefined || a === 0) continue;
            gain += (weight * (a - b)) / Math.abs(a);
            counted += 1;
          }
          if (counted === 0) {
            throw new Error(
              `None of the objective stats ${weights.map(([k]) => k).join(", ")} is in the calculation of slot ${entry.slot}`,
            );
          }
          if (cost.status !== "ok" || cost.value.amount <= 0) {
            upgrades.push({
              slot: entry.slot,
              sort: Number.NEGATIVE_INFINITY,
              ratio: {
                status: "uncalibrated",
                reason:
                  cost.status === "ok"
                    ? "The item has no positive price to divide by."
                    : "The gain per cost needs a price, and this item has none.",
              },
            });
            continue;
          }
          upgrades.push({
            slot: entry.slot,
            sort: gain / cost.value.amount,
            ratio: {
              status: "ok",
              value: gain / cost.value.amount,
              source: {
                kind: "derived",
                formula: GAIN_PER_COST_FORMULA,
                formulaVersion: GAIN_PER_COST_VERSION,
                inputs: [
                  withAll.source,
                  without.source,
                  ...(cost.source.kind === "market" ? [cost.source] : cost.source.inputs),
                ],
              },
            },
          });
        }
        out.push({
          budgetTier: tier.id,
          slots,
          upgradeOrder: upgrades
            .sort((a, b) => b.sort - a.sort)
            .map((u) => ({ slot: u.slot, gainPerCost: u.ratio })),
        });
      }
      const plan = GearPlan.safeParse({ tiers: out });
      if (!plan.success) {
        throw new Error("The gear plan is not valid", { cause: plan.error });
      }
      return JSON.parse(JSON.stringify(plan.data)) as JsonValue;
    },
  };
}
