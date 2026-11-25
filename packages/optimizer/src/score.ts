import type { FloorViolation, Metrics, Objective } from "./types.ts";

/** All metric names an objective needs from the engine. */
export function objectiveMetrics(objective: Objective): string[] {
  return [...new Set([...Object.keys(objective.weights), ...Object.keys(objective.floors ?? {})])];
}

export class Scorer {
  private readonly scales = new Map<string, number>();

  /** `reference` = metrics of the state the objective is measured against. */
  constructor(
    readonly objective: Objective,
    readonly reference: Metrics,
    private readonly floorPenalty: number,
  ) {
    for (const metric of objectiveMetrics(objective)) {
      const given = objective.scales?.[metric];
      const ref = Math.abs(reference[metric] ?? 0);
      this.scales.set(metric, given !== undefined && given > 0 ? given : ref > 0 ? ref : 1);
    }
  }

  violations(metrics: Metrics): FloorViolation[] {
    const out: FloorViolation[] = [];
    for (const [metric, required] of Object.entries(this.objective.floors ?? {})) {
      const actual = metrics[metric] as number;
      if (actual < required) out.push({ metric, required, actual });
    }
    return out;
  }

  /** Normalized objective value: weighted relative gain minus penalized floor shortfalls. */
  score(metrics: Metrics): number {
    let total = 0;
    for (const [metric, weight] of Object.entries(this.objective.weights)) {
      total +=
        (weight * ((metrics[metric] as number) - (this.reference[metric] as number))) /
        (this.scales.get(metric) as number);
    }
    for (const v of this.violations(metrics)) {
      total -=
        (this.floorPenalty * (v.required - v.actual)) / (this.scales.get(v.metric) as number);
    }
    return total;
  }

  /** Weighted gain of metric deltas only (no floors); used for node power priors. */
  deltaScore(deltas: Metrics): number {
    let total = 0;
    for (const [metric, weight] of Object.entries(this.objective.weights)) {
      total += (weight * (deltas[metric] ?? 0)) / (this.scales.get(metric) as number);
    }
    return total;
  }
}
