import { z } from "zod";
import { CalcResult } from "../calc/result.js";
import { CalcId } from "../common/version.js";
import { PublishedGuide } from "./document.js";

/** Marker of an Astrolabe guide file, so another JSON file is not taken for one. */
export const GUIDE_FILE_FORMAT = "astrolabe-guide";

/** Every value of a field named `calcId` anywhere in the value (calc segments, outcomes, sources). */
export function collectCalcIds(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== "object" || node === null) return;
    for (const [field, inner] of Object.entries(node)) {
      if (field === "calcId" && typeof inner === "string" && inner !== "") found.add(inner);
      else walk(inner);
    }
  };
  walk(value);
  return [...found];
}

/**
 * A guide as a file that can be handed to another installation (server: GET
 * /api/guides/:id/file to export, POST /api/guides/import to import): the guide and the stored
 * PoB results its numbers refer to, keyed by `calcId`.
 *
 * Complete by contract: every `calcId` the guide refers to has its result in the file, so an
 * import never leaves a number without its measurement. The results and the validation report
 * are the measurements of the installation that made the file; the import checks their form and
 * that they belong together, it does not recalculate them.
 */
export const GuideFile = z
  .object({
    format: z.literal(GUIDE_FILE_FORMAT),
    /** Version of this file layout. */
    version: z.literal(1),
    guide: PublishedGuide,
    results: z.record(CalcId, CalcResult),
  })
  .superRefine((file, ctx) => {
    for (const [key, result] of Object.entries(file.results)) {
      if (result.calcId !== key) {
        ctx.addIssue({
          code: "custom",
          path: ["results", key],
          message: `result is stored under ${key} but carries calcId ${result.calcId}`,
        });
      }
    }
    for (const calcId of collectCalcIds(file.guide)) {
      if (!Object.hasOwn(file.results, calcId)) {
        ctx.addIssue({
          code: "custom",
          path: ["results"],
          message: `the guide refers to calcId ${calcId} but the file has no result for it`,
        });
      }
    }
  });
export type GuideFile = z.infer<typeof GuideFile>;
