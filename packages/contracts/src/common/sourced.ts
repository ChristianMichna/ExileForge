import { z } from "zod";
import { EntityRef } from "./ids.js";
import { CalcId, CalcProfileId, DataReleaseId, IsoDateTime, PobVersion } from "./version.js";

/*
 * Principle "no number without engine": every number Astrolabe shows carries
 * its origin. LLM outputs never contain such numbers; they reference them
 * (CalcRef) and the app fills them in.
 */

/** Number computed by Path of Building. */
export const PobSource = z.object({
  kind: z.literal("pob"),
  pobVersion: PobVersion,
  dataReleaseId: DataReleaseId,
  calcProfile: CalcProfileId,
  calcId: CalcId,
});

/** Number read from the game data of a data release (e.g. a mod range). */
export const GamedataSource = z.object({
  kind: z.literal("gamedata"),
  dataReleaseId: DataReleaseId,
  entity: EntityRef,
  /** JSON pointer into the entity, e.g. "/stats/0/max". */
  field: z.string().startsWith("/").describe("JSON pointer into the catalog entity"),
});

/** Price from a market data provider, always with timestamp and league. */
export const MarketSource = z.object({
  kind: z.literal("market"),
  provider: z.string().min(1).describe("Provider id from config, e.g. the economy API in use"),
  league: z.string().min(1),
  fetchedAt: IsoDateTime,
  confidence: z.enum(["high", "medium", "low"]),
});

/** Inputs of a derived number; derived values are not nested. */
export const PrimarySource = z.discriminatedUnion("kind", [
  PobSource,
  GamedataSource,
  MarketSource,
]);
export type PrimarySource = z.infer<typeof PrimarySource>;

/** Number computed deterministically by Astrolabe from other sourced numbers. */
export const DerivedSource = z.object({
  kind: z.literal("derived"),
  /** Id of the deterministic formula, e.g. "crafting.expected-cost" – owned by the computing package. */
  formula: z.string().min(1),
  /** Version of the computing package or formula, so results can be reproduced. */
  formulaVersion: z.string().min(1),
  inputs: z.array(PrimarySource).min(1),
  /** Seed for stochastic formulas (Monte Carlo); absent for closed-form ones. */
  seed: z.int().optional(),
});

export const Source = z.discriminatedUnion("kind", [
  PobSource,
  GamedataSource,
  MarketSource,
  DerivedSource,
]);
export type Source = z.infer<typeof Source>;

/** A value together with where it came from. */
export const sourced = <T extends z.ZodType>(value: T) => z.object({ value, source: Source });
export type Sourced<T> = { value: T; source: Source };

/**
 * A number that may legitimately be missing. Missing data is never a silent
 * fallback (0, [], stale value): it is "uncalibrated" (no data yet) or
 * "failed" (an attempt to obtain it failed) and the UI shows that.
 */
export const measured = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), value, source: Source }),
    z.object({ status: z.literal("uncalibrated"), reason: z.string().min(1) }),
    z.object({
      status: z.literal("failed"),
      error: z.object({ code: z.string().min(1), message: z.string().min(1) }),
    }),
  ]);
export type Measured<T> =
  | { status: "ok"; value: T; source: Source }
  | { status: "uncalibrated"; reason: string }
  | { status: "failed"; error: { code: string; message: string } };

/**
 * Like measured(), but only the given source kinds are allowed, e.g. prices
 * must come from the market or be derived, never from PoB.
 */
export const measuredFrom = <T extends z.ZodType, S extends readonly [AnySource, ...AnySource[]]>(
  value: T,
  sources: S,
) =>
  z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      value,
      source: z.discriminatedUnion("kind", sources),
    }),
    z.object({ status: z.literal("uncalibrated"), reason: z.string().min(1) }),
    z.object({
      status: z.literal("failed"),
      error: z.object({ code: z.string().min(1), message: z.string().min(1) }),
    }),
  ]);
type AnySource =
  typeof PobSource | typeof GamedataSource | typeof MarketSource | typeof DerivedSource;

/**
 * Reference to one number of a PoB calculation. Guide text and LLM outputs
 * use this instead of writing a number.
 */
export const CalcRef = z.object({
  calcId: CalcId,
  /** Key in CalcResult.stats (PoB output name). */
  stat: z.string().min(1),
});
export type CalcRef = z.infer<typeof CalcRef>;
