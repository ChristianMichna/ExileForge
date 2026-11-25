import {
  type ArchetypeCandidate,
  type BuildState,
  GearPlan,
  type ItemSpec,
  type TargetBuild,
} from "@astrolabe/contracts/build";
import type { ItemPrice, PricedItemRef } from "@astrolabe/contracts";
import type { CalcId, JsonValue, PrimarySource } from "@astrolabe/contracts/common";
import type { PipelineContext, PlanStep } from "../pipeline.js";
import { GearChoice, gearKey, geared, type S7Config } from "./s7-gear.js";

type PobSource = Extract<PrimarySource, { kind: "pob" }>;

export const S7_PLAN_KEY = "S7.plan";

/** Formula id of the upgrade ranking; bump the version when its arithmetic changes. */
export const GAIN_PER_COST_FORMULA = "gear.gain-per-cost";
export const GAIN_PER_COST_VERSION = "1";

/** The economy.price contract limit per call. */
const PRICE_CHUNK = 200;

type Tier = GearPlan["tiers"][number];
type MeasuredPrice = Tier["slots"][number]["cost"];
type Ratio = Tier["upgradeOrder"][number]["gainPerCost"];

/** The market ref of an item, if it has one; crafted rares are priced by S8. */
function pricedRef(item: ItemSpec): PricedItemRef | undefined {
  return item.kind === "unique" ? { kind: "uniqueItem", id: item.uniqueId } : undefined;
}

const refKey = (r: PricedItemRef): string => `${r.kind}:${r.id}`;

/** Stable text of the weights, so the formula version changes when they do. */
function weightsKey(weights: Record<string, number>): string {
  return Object.entries(weights)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

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
      const profile = s7.objective.calcProfile;
      const choices = tiers.map((tier) => {
        const parsed = GearChoice.safeParse(runCtx.result(gearKey(tier.id)));
        if (!parsed.success) {
          throw new Error(`The stored gear of tier ${tier.id} is unreadable`, {
            cause: parsed.error,
          });
        }
        return { tier, choice: parsed.data };
      });

      // Unique items of all tiers, priced in as few calls as the contract allows.
      const refs = new Map<string, PricedItemRef>();
      for (const { choice } of choices) {
        for (const slot of choice.slots) {
          const ref = pricedRef(slot.target);
          if (ref !== undefined) refs.set(refKey(ref), ref);
        }
      }
      const prices = new Map<string, MeasuredPrice>();
      let priceError: { code: string; message: string } | undefined;
      let staleBook = false;
      const noService = refs.size > 0 && runCtx.economy === undefined;
      if (refs.size > 0 && runCtx.economy !== undefined) {
        const all = [...refs.values()];
        try {
          for (let i = 0; i < all.length; i += PRICE_CHUNK) {
            const answer = await runCtx.economy.price({
              ...(runCtx.run.request.league === undefined
                ? {}
                : { league: runCtx.run.request.league }),
              items: all.slice(i, i + PRICE_CHUNK),
            });
            if (answer.freshness === "stale") staleBook = true;
            answer.prices.forEach((p: ItemPrice) => prices.set(refKey(p.item), p.price));
          }
        } catch (cause) {
          priceError = {
            code: "price_fetch_failed",
            message: cause instanceof Error ? cause.message : String(cause),
          };
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
        if (staleBook) {
          return {
            status: "uncalibrated",
            reason: "The price refresh failed and only an older price book exists.",
          };
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
      ): Promise<{ stats: Record<string, number>; source: PobSource }> => {
        const outcome = (await runCtx.calc.calculate({ state, profiles: [profile] }))[profile];
        if (outcome === undefined || outcome.status === "failed") {
          throw new Error(
            `The engine could not measure the gear (profile ${profile}): ${outcome?.error.message ?? "no result"}`,
          );
        }
        const result = await runCtx.calc.getResult(outcome.calcId);
        if (result === undefined) throw new Error(`Calc result ${outcome.calcId} is not stored`);
        return {
          stats: result.stats,
          source: {
            kind: "pob",
            pobVersion: result.pobVersion,
            dataReleaseId: result.dataReleaseId,
            calcProfile: result.calcProfile,
            calcId: outcome.calcId as CalcId,
          },
        };
      };
      const weights = Object.entries(s7.objective.weights);
      const formulaVersion = `${GAIN_PER_COST_VERSION}:${weightsKey(s7.objective.weights)}`;
      // Taking a slot away also takes away the slots that depend on it (the off-hand of a weapon).
      const removed = (slot: string): Set<string> =>
        new Set([slot, ...s7.slots.filter((s) => s.dependsOnSlot === slot).map((s) => s.id)]);

      const out: Tier[] = [];
      for (const { tier, choice } of choices) {
        const withAll = await measure(geared(target.state, choice));
        const slots: Tier["slots"] = [];
        const upgrades: { slot: string; ratio: Ratio; sort: number }[] = [];
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
          if (cost.status === "failed") {
            upgrades.push({
              slot: entry.slot,
              sort: Number.NEGATIVE_INFINITY,
              ratio: { status: "failed", error: cost.error },
            });
            continue;
          }
          if (cost.status === "uncalibrated" || cost.value.amount <= 0) {
            upgrades.push({
              slot: entry.slot,
              sort: Number.NEGATIVE_INFINITY,
              ratio: {
                status: "uncalibrated",
                reason:
                  cost.status === "uncalibrated"
                    ? `The gain per cost needs a price: ${cost.reason}`
                    : "The item has no positive price to divide by.",
              },
            });
            continue;
          }
          const gone = removed(entry.slot);
          const without = await measure(
            geared(target.state, { slots: choice.slots.filter((s) => !gone.has(s.slot)) }),
          );
          let gain = 0;
          let incomplete: string | undefined;
          for (const [stat, weight] of weights) {
            const a = withAll.stats[stat];
            const b = without.stats[stat];
            if (a === undefined || b === undefined) {
              incomplete = `${stat} is missing in the calculation`;
              break;
            }
            if (a === 0) {
              incomplete = `${stat} is zero with the item, so the relative gain is undefined`;
              break;
            }
            gain += (weight * (a - b)) / Math.abs(a);
          }
          if (incomplete !== undefined) {
            upgrades.push({
              slot: entry.slot,
              sort: Number.NEGATIVE_INFINITY,
              ratio: {
                status: "uncalibrated",
                reason: `The objective is incomplete: ${incomplete}.`,
              },
            });
            continue;
          }
          const value = gain / cost.value.amount;
          upgrades.push({
            slot: entry.slot,
            sort: value,
            ratio: {
              status: "ok",
              value,
              source: {
                kind: "derived",
                formula: GAIN_PER_COST_FORMULA,
                formulaVersion,
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
          calcs: { [profile]: { status: "ok", calcId: withAll.source.calcId } },
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
