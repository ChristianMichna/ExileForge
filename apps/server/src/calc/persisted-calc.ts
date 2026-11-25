import type { BuildState, CalcOutcome } from "@astrolabe/contracts/build";
import type { CalcResult, ConfigOverrides } from "@astrolabe/contracts/calc";
import type { CalcId, CalcProfileId } from "@astrolabe/contracts/common";
import type { CalcPort } from "../ports/calc.js";
import type { RunStore } from "../store/run-store.js";

/**
 * Keeps every calculation result in the run store, so calc references in
 * stored runs stay valid after a restart (whatever engine computed them).
 */
export class PersistedCalc implements CalcPort {
  constructor(
    private readonly inner: CalcPort,
    private readonly store: RunStore,
  ) {}

  get engine(): CalcPort["engine"] {
    return this.inner.engine;
  }

  async calculate(input: {
    state: BuildState;
    profiles: readonly CalcProfileId[];
    overrides?: ConfigOverrides;
  }): Promise<Record<CalcProfileId, CalcOutcome>> {
    const outcomes = await this.inner.calculate(input);
    for (const outcome of Object.values(outcomes)) {
      if (outcome.status !== "ok") continue;
      const result = await this.inner.getResult(outcome.calcId);
      if (result === undefined) {
        throw new Error(`Engine reported calc ${outcome.calcId} but has no result for it`);
      }
      this.store.saveCalcResult(result);
    }
    return outcomes;
  }

  async getResult(calcId: CalcId): Promise<CalcResult | undefined> {
    return this.store.loadCalcResult(calcId) ?? (await this.inner.getResult(calcId));
  }
}
