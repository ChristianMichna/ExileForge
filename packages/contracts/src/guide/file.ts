import { z } from "zod";
import { CalcResult } from "../calc/result.js";
import { PublishedGuide } from "./document.js";

/** Marker of an Astrolabe guide file, so another JSON file is not taken for one. */
export const GUIDE_FILE_FORMAT = "astrolabe-guide";

/**
 * A guide as a file that can be handed to another installation (server: GET
 * /api/guides/:id/file to export, POST /api/guides/import to import): the guide and the stored
 * PoB results its numbers refer to, keyed by `calcId`. The numbers stay measured: results are
 * validated on import and are never recalculated or replaced.
 */
export const GuideFile = z
  .object({
    format: z.literal(GUIDE_FILE_FORMAT),
    /** Version of this file layout. */
    version: z.literal(1),
    guide: PublishedGuide,
    results: z.record(z.string().min(1), CalcResult),
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
  });
export type GuideFile = z.infer<typeof GuideFile>;
