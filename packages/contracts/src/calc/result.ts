import { z } from "zod";
import {
  CalcId,
  CalcProfileId,
  DataReleaseId,
  IsoDateTime,
  PobVersion,
  Sha256,
} from "../common/version.js";

/**
 * Stat values keyed by Path of Building output name. Deliberately an open
 * record: which stats exist is PoB's (and the patch's) business; which ones
 * the UI shows is configured in config/, not here.
 */
export const StatMap = z.record(z.string().min(1), z.number());
export type StatMap = z.infer<typeof StatMap>;

/** Result of one PoB calculation. Every engine number in ExileForge points here via calcId. */
export const CalcResult = z.object({
  calcId: CalcId,
  pobVersion: PobVersion,
  dataReleaseId: DataReleaseId,
  calcProfile: CalcProfileId,
  /** Hash of the exact build state (PoB XML) that was calculated. */
  inputHash: Sha256,
  computedAt: IsoDateTime,
  /** PoB's main skill selection, as PoB names it. */
  mainSkill: z.string().min(1).optional(),
  stats: StatMap,
  /** PoB notices, e.g. unmet requirements. */
  warnings: z.array(z.string()),
  /** Item/passive lines PoB could not parse; the guide must list them and may not claim numbers for them. */
  unsupportedMods: z.array(z.string()),
});
export type CalcResult = z.infer<typeof CalcResult>;
