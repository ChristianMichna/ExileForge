import type { BuildState, CalcOutcome } from "@exileforge/contracts/build";
import type { CalcResult } from "@exileforge/contracts/calc";
import type { CalcId, CalcProfileId } from "@exileforge/contracts/common";

/** Which engine answers: the PoB worker pool, or calc-fake (fantasy values, tests and PoC only). */
export type CalcEngineKind = "pob" | "fake";

/**
 * The server's narrow view of the calc service. The real adapter maps this
 * onto @exileforge/calc (build.load + calc.stats per profile) once the
 * BuildState → PoB conversion exists; until then calc-fake implements it.
 *
 * A failed calculation is a `failed` outcome, never a zero or an empty result.
 */
export interface CalcPort {
  readonly engine: CalcEngineKind;
  calculate(input: {
    state: BuildState;
    profiles: readonly CalcProfileId[];
  }): Promise<Record<CalcProfileId, CalcOutcome>>;
  /** Result of an earlier calculation; undefined if the id is unknown. */
  getResult(calcId: CalcId): Promise<CalcResult | undefined>;
}
