import type { CalcResult } from "@astrolabe/contracts/calc";
import { ForgeError } from "../engine/errors.js";
import type { CalcPort } from "../ports/calc.js";

/**
 * Catalog-only mode: there is no engine for this data release (for example
 * right after a new game patch, before Path of Building has a matching
 * release). Every calculation is refused with a clear error; nothing returns
 * a zero or an empty result.
 */
export class CalcNone implements CalcPort {
  readonly engine = "none" as const;

  constructor(readonly reason: string) {}

  calculate(): never {
    throw new ForgeError("calc_unavailable", this.reason);
  }

  getResult(): Promise<CalcResult | undefined> {
    return Promise.resolve(undefined);
  }
}

/** Why the engine is missing; shown to the player and returned by `/api/health`. */
export function catalogOnlyReason(input: {
  pobVersion: string | undefined;
  releasePobVersion: string | undefined;
}): string {
  const wanted = input.releasePobVersion ?? "unknown";
  const have = input.pobVersion ?? "none";
  return `Catalog only: this data release needs Path of Building ${wanted}, the installed engine is ${have}. Planning and calculations are unavailable until a matching Path of Building release is installed.`;
}

/** True if the installed PoB is not the one the data release was built for. */
export function pobMismatch(pobVersion: string, releasePobVersion: string | undefined): boolean {
  if (releasePobVersion === undefined) return false;
  const strip = (v: string): string => v.replace(/^v/, "");
  return strip(pobVersion) !== strip(releasePobVersion);
}
