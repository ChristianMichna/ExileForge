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
export const CandidateComparisonView = z
  .object({
    runId: z.string().min(1),
    /** The data release the server (and so the catalog behind `names`) runs with. */
    catalogReleaseId: DataReleaseId,
    /**
     * Whether the run was made with `catalogReleaseId`. When it was not, the server resolves no
     * names (they would come from the wrong catalog) and lists every reference in `unresolved`;
     * stored results carry their own release and stay.
     */
    current: z.boolean(),
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
  })
  .superRefine((v, ctx) => {
    const keys = new Set(v.candidates.map((c) => c.key));
    if (keys.size !== v.candidates.length) {
      ctx.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "candidate keys must be unique",
      });
    }
    const seen = new Set<string>();
    v.evaluations.forEach((e, i) => {
      if (!keys.has(e.candidateKey) || seen.has(e.candidateKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["evaluations", i, "candidateKey"],
          message: "each evaluation must belong to one listed candidate, once",
        });
      }
      seen.add(e.candidateKey);
    });
    if (v.chosenKey !== undefined && !keys.has(v.chosenKey)) {
      ctx.addIssue({
        code: "custom",
        path: ["chosenKey"],
        message: "chosenKey is not a listed candidate",
      });
    }
    for (const [id, r] of Object.entries(v.results)) {
      if (r.calcId !== id) {
        ctx.addIssue({
          code: "custom",
          path: ["results", id],
          message: "result key must equal its calcId",
        });
      }
    }
    const unresolved = new Set(v.unresolved);
    v.evaluations.forEach((e, i) => {
      for (const [profile, o] of Object.entries(e.calcs)) {
        if (
          o.status === "ok" &&
          v.results[o.calcId] === undefined &&
          !unresolved.has(`calc:${o.calcId}`)
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["evaluations", i, "calcs", profile],
            message: `result ${o.calcId} is neither stored nor listed as unresolved`,
          });
        }
      }
    });
  });
export type CandidateComparisonView = z.infer<typeof CandidateComparisonView>;
