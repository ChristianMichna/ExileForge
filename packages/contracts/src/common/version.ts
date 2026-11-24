import { z } from "zod";

/**
 * Data release id: `poe2-<gameVersion>+r<pipelineRevision>`, e.g.
 * `poe2-1.0.0.3+r2`. The game version part is whatever the pipeline detected;
 * nothing in code depends on a concrete value.
 */
export const DATA_RELEASE_ID_PATTERN = /^poe2-(\d+(?:\.\d+){1,3})\+r(\d+)$/;

export const DataReleaseId = z
  .string()
  .regex(DATA_RELEASE_ID_PATTERN, "expected poe2-<gameVersion>+r<revision>")
  .describe("Data release id, e.g. poe2-<gameVersion>+r<revision>")
  .brand<"DataReleaseId">();
export type DataReleaseId = z.infer<typeof DataReleaseId>;

export const GameVersion = z
  .string()
  .regex(/^\d+(?:\.\d+){1,3}$/, "expected dotted numeric game version")
  .describe("Game version as reported by the data source");
export type GameVersion = z.infer<typeof GameVersion>;

/** Path of Building release tag, e.g. `v0.23.1`. */
export const PobVersion = z
  .string()
  .regex(/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, "expected PoB release tag")
  .describe("Path of Building PoE2 release tag");
export type PobVersion = z.infer<typeof PobVersion>;

export const IsoDateTime = z.iso.datetime({ offset: true }).describe("ISO 8601 timestamp");
export type IsoDateTime = z.infer<typeof IsoDateTime>;

export const Sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "expected lowercase hex sha256")
  .describe("SHA-256 as lowercase hex");
export type Sha256 = z.infer<typeof Sha256>;

/** Calc profile id; the profiles themselves live versioned in config/calc-profiles/. */
export const CalcProfileId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "expected kebab-case profile id")
  .describe("Calc profile id from config/calc-profiles/");
export type CalcProfileId = z.infer<typeof CalcProfileId>;

/** Id of one Path of Building calculation; every engine number points to one. */
export const CalcId = z
  .string()
  .min(1)
  .max(128)
  .describe("Id of a single PoB calculation")
  .brand<"CalcId">();
export type CalcId = z.infer<typeof CalcId>;

/** Parses a data release id into its parts. Throws on invalid input. */
export function parseDataReleaseId(id: string): { gameVersion: string; revision: number } {
  const match = DATA_RELEASE_ID_PATTERN.exec(id);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Invalid data release id: ${JSON.stringify(id)}`);
  }
  return { gameVersion: match[1], revision: Number(match[2]) };
}
