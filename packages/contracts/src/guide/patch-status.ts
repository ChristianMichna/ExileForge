import { z } from "zod";
import { EntityRef } from "../common/ids.js";
import { DataReleaseId, IsoDateTime } from "../common/version.js";
import { FieldChange } from "../catalog/release.js";

/** Version of the PatchStatus layout; bump with a migration. */
export const PATCH_STATUS_SCHEMA_VERSION = 1;

/**
 * What a new data release did to one entity a guide refers to. An entity the diff
 * does not mention is unaffected and is not listed.
 */
export const PatchImpact = z.enum([
  /** The id is gone in the new release (gate G1 would fail): the guide cannot be kept as is. */
  "removed",
  /** The entity still exists, but fields changed: numbers and choices must be checked again. */
  "changed",
]);
export type PatchImpact = z.infer<typeof PatchImpact>;

export const PatchFinding = z
  .object({
    ref: EntityRef,
    impact: PatchImpact,
    /** JSON pointers into the GuideDocument where the entity is used (at least one). */
    locations: z.array(z.string().startsWith("/")).min(1),
    /** The changed fields of the entity, copied from the CatalogDiff; only for `changed`. */
    fields: z.array(FieldChange).min(1).optional(),
  })
  .superRefine((f, ctx) => {
    if (f.impact === "changed" && f.fields === undefined)
      ctx.addIssue({ code: "custom", path: ["fields"], message: "needed for impact changed" });
    if (f.impact === "removed" && f.fields !== undefined)
      ctx.addIssue({ code: "custom", path: ["fields"], message: "not allowed for impact removed" });
  });
export type PatchFinding = z.infer<typeof PatchFinding>;

/**
 * Verdict of the revalidation of one stored guide revision against a newer data
 * release (F-19). Derived from the findings, never set by hand:
 * `broken` if any reference was removed, `needs-recalc` if any changed, else `unaffected`.
 */
export const PatchVerdict = z.enum(["unaffected", "needs-recalc", "broken"]);
export type PatchVerdict = z.infer<typeof PatchVerdict>;

export const PatchStatus = z
  .object({
    schemaVersion: z.literal(PATCH_STATUS_SCHEMA_VERSION),
    guideId: z.uuid(),
    guideRevision: z.int().nonnegative(),
    /** The release the guide was built with (`GuideMetadata.dataReleaseId`). */
    fromReleaseId: DataReleaseId,
    /** The newer release it was checked against. */
    toReleaseId: DataReleaseId,
    checkedAt: IsoDateTime,
    /** How many distinct entities the guide refers to; shows the check looked at something. */
    checkedReferences: z.int().nonnegative(),
    verdict: PatchVerdict,
    findings: z.array(PatchFinding),
  })
  .superRefine((s, ctx) => {
    if (s.fromReleaseId === s.toReleaseId)
      ctx.addIssue({
        code: "custom",
        path: ["toReleaseId"],
        message: "must differ from fromReleaseId",
      });
    const expected: PatchVerdict = s.findings.some((f) => f.impact === "removed")
      ? "broken"
      : s.findings.length > 0
        ? "needs-recalc"
        : "unaffected";
    if (s.verdict !== expected)
      ctx.addIssue({
        code: "custom",
        path: ["verdict"],
        message: `must be ${expected} for these findings`,
      });
    if (s.findings.length > s.checkedReferences)
      ctx.addIssue({
        code: "custom",
        path: ["findings"],
        message: "more findings than checked references",
      });
    const seen = new Set<string>();
    s.findings.forEach((f, i) => {
      const key = `${f.ref.kind}:${f.ref.id}`;
      if (seen.has(key))
        ctx.addIssue({
          code: "custom",
          path: ["findings", i, "ref"],
          message: "duplicate reference",
        });
      seen.add(key);
    });
  });
export type PatchStatus = z.infer<typeof PatchStatus>;
