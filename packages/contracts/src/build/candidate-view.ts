import { z } from "zod";
import { CalcResult } from "../calc/result.js";
import { DataReleaseId } from "../common/version.js";
import { ArchetypeCandidate, ArchetypeEvaluation } from "./stages.js";

/**
 * The candidates of a run with everything the app window needs to compare them (server:
 * GET /api/runs/:runId/candidates): the S2 ideas, the S3 measurements of their skeleton builds,
 * the display names of the entities they refer to and the stored PoB results behind the numbers.
 * Nothing here is made up: a name or result the server does not have stays absent and is listed
 * in `unresolved`.
 */
export const CandidateComparisonView = z.object({
  runId: z.string().min(1),
  /** The data release the server (and so the catalog behind `names`) runs with. */
  catalogReleaseId: DataReleaseId,
  /** The S2 candidates written so far, in order. */
  candidates: z.array(ArchetypeCandidate),
  /** The S3 measurements, one per candidate; empty until S3 is done. */
  evaluations: z.array(ArchetypeEvaluation),
  /** The candidate the player picked (S4), once the pick is stored. */
  chosenKey: z.string().min(1).optional(),
  /** Display names by `<kind>:<id>` of the entity. */
  names: z.record(z.string().min(1), z.string().min(1)),
  /** Stored calculation results by calc id, for the numbers of the evaluations and the texts. */
  results: z.record(z.string().min(1), CalcResult),
  /** Catalog references and calc ids the server could not resolve, as `<kind>:<id>` and `calc:<id>`. */
  unresolved: z.array(z.string().min(1)),
});
export type CandidateComparisonView = z.infer<typeof CandidateComparisonView>;
