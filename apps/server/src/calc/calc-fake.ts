import { createHash } from "node:crypto";
import type { BuildState, CalcOutcome } from "@exileforge/contracts/build";
import type { CalcResult } from "@exileforge/contracts/calc";
import { CalcId, type CalcProfileId, type DataReleaseId } from "@exileforge/contracts/common";
import type { CalcPort } from "../ports/calc.js";

/** Marker version so fake results can never pass as a real PoB release. */
export const FAKE_POB_VERSION = "v0.0.0-calc-fake";

export interface CalcFakeOptions {
  dataReleaseId: DataReleaseId;
  /** Returns an error message to make a calculation fail (tests of the failure path). */
  failWhen?: (state: BuildState, profile: CalcProfileId) => string | undefined;
  now?: () => Date;
}

/**
 * calc-fake: deterministic fantasy values for logic tests and the PoC loop.
 * Stat names start with "fake." so nothing downstream can mistake them for
 * PoB output; the same state and profile always give the same numbers.
 */
export class CalcFake implements CalcPort {
  readonly engine = "fake" as const;
  private readonly results = new Map<string, CalcResult>();

  constructor(private readonly options: CalcFakeOptions) {}

  async calculate(input: {
    state: BuildState;
    profiles: readonly CalcProfileId[];
  }): Promise<Record<CalcProfileId, CalcOutcome>> {
    const outcomes: Record<CalcProfileId, CalcOutcome> = {};
    const inputHash = createHash("sha256").update(stableJson(input.state)).digest("hex");
    for (const profile of input.profiles) {
      const failure = this.options.failWhen?.(input.state, profile);
      if (failure !== undefined) {
        outcomes[profile] = {
          status: "failed",
          error: { code: "calc_fake_failure", message: failure },
        };
        continue;
      }
      const calcId = CalcId.parse(`fake-${inputHash.slice(0, 16)}-${profile}`);
      const seed = Number.parseInt(inputHash.slice(0, 8), 16);
      this.results.set(calcId, {
        calcId,
        pobVersion: FAKE_POB_VERSION,
        dataReleaseId: this.options.dataReleaseId,
        calcProfile: profile,
        inputHash,
        computedAt: (this.options.now?.() ?? new Date()).toISOString(),
        stats: {
          "fake.alpha": seed % 1000,
          "fake.beta": (seed >>> 10) % 1000,
          "fake.level": input.state.level,
          "fake.skillCount": input.state.skills.length,
        },
        warnings: [],
        unsupportedMods: [],
      });
      outcomes[profile] = { status: "ok", calcId };
    }
    return outcomes;
  }

  async getResult(calcId: CalcId): Promise<CalcResult | undefined> {
    return this.results.get(calcId);
  }
}

/** JSON with sorted object keys, so equal states hash equally. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}
