import { z } from "zod";
import { CalcResult } from "../calc/result.js";
import { DataReleaseId } from "../common/version.js";
import { PublishedGuide } from "./document.js";

/**
 * A stored guide with everything the app window needs to show it (server:
 * GET /api/guides/:guideId/view): the display names of the catalog entities it refers to and
 * the stored calculation results behind its numbers. Nothing here is made up: a name or result
 * the server does not have is listed in `unresolved` and stays absent.
 */
export const GuideView = z.object({
  guide: PublishedGuide,
  /** The data release the server (and so the catalog behind `names`) runs with. */
  catalogReleaseId: DataReleaseId,
  /**
   * The guide was built with `catalogReleaseId`. When false, no names are resolved (the same id
   * can mean something else in another release): every catalog reference is in `unresolved`
   * and the guide needs revalidation. Results carry their own release and stay.
   */
  current: z.boolean(),
  /** Display names by `<kind>:<id>` of the entity (e.g. `gem:Metadata/Items/Gem/Foo`). */
  names: z.record(z.string().min(1), z.string().min(1)),
  /** Stored calculation results by calc id, for the numbers of the guide and of its stages. */
  results: z.record(z.string().min(1), CalcResult),
  /** Catalog references and calc ids the server could not resolve, as `<kind>:<id>` and `calc:<id>`. */
  unresolved: z.array(z.string().min(1)),
});
export type GuideView = z.infer<typeof GuideView>;
