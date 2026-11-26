import type { CalcOutcome, ProgressionStage } from "@astrolabe/contracts/build";
import type { GuideView } from "@astrolabe/contracts/guide";
import { Panel, StatGrid, StatValue } from "@astrolabe/ui";
import type { ValueState } from "@astrolabe/ui";
import { GUIDE_STATS } from "../guide/guide-stats";
import { priceLabel, priceState } from "../guide/price";

/*
 * The engine numbers of one stage: the stats chosen in config/web/guide-stats.json, read from the
 * stored result of the first calc profile the stage has. A failed calculation, a result the server
 * no longer has and a stat the result does not contain are each shown as what they are; nothing
 * is replaced by 0.
 */

function outcomeOf(stage: ProgressionStage): { profile: string; outcome: CalcOutcome } | undefined {
  for (const profile of GUIDE_STATS.calcProfiles) {
    const outcome = stage.calcs[profile];
    if (outcome !== undefined) return { profile, outcome };
  }
  return undefined;
}

function stateOf(
  stat: string,
  found: { profile: string; outcome: CalcOutcome } | undefined,
  view: GuideView,
): ValueState {
  if (found === undefined) {
    return {
      status: "uncalibrated",
      reason: "This stage has no calculation for the shown profiles.",
    };
  }
  if (found.outcome.status === "failed") {
    return { status: "error", message: found.outcome.error.message };
  }
  const result = view.results[found.outcome.calcId];
  if (result === undefined) {
    return { status: "error", message: "The stored result of this calculation is not available." };
  }
  const value = result.stats[stat];
  if (value === undefined) {
    return { status: "uncalibrated", reason: `Path of Building did not report ${stat}.` };
  }
  return {
    status: "ready",
    value,
    provenance: { kind: "pob", pobVersion: result.pobVersion, calcProfile: result.calcProfile },
    // A result of another data release than the guide's current one is outdated.
    ...(result.dataReleaseId === view.catalogReleaseId ? {} : { stale: true }),
  };
}

export function StageNumbers({ stage, view }: { stage: ProgressionStage; view: GuideView }) {
  const found = outcomeOf(stage);
  return (
    <Panel
      title="Numbers"
      kicker={found === undefined ? "No calculation" : `Profile ${found.profile}`}
    >
      <StatGrid>
        {GUIDE_STATS.stats.map((s) => (
          <StatValue
            key={s.stat}
            label={s.label}
            {...(s.emphasis === true ? { emphasis: true } : {})}
            state={stateOf(s.stat, found, view)}
          />
        ))}
        {stage.respecCost === undefined ? null : (
          <StatValue
            label={`Respec · ${priceLabel(stage.respecCost, view)}`}
            format="decimal1"
            state={priceState(stage.respecCost)}
          />
        )}
      </StatGrid>
    </Panel>
  );
}
