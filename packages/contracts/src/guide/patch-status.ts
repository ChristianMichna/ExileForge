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
    /**
     * Stages (`ProgressionStage.id`) that use the entity, so the guide can show which stages
     * are affected. Empty where the entity is not tied to a stage.
     */
    stageIds: z.array(z.string().min(1)).default([]),
    /**
     * The changed fields of the entity; only for `changed`. Over a chain of releases `before`
     * is the value in the guide's release and `after` the value in the checked release;
     * fields that end up unchanged are left out.
     */
    fields: z.array(FieldChange).min(1).optional(),
    /**
     * Entities of the new release that may replace a removed one, taken from the catalog and
     * never guessed; only for `removed`, and only if the catalog offers any.
     */
    candidates: z.array(EntityRef).optional(),
  })
  .superRefine((f, ctx) => {
    if (f.impact === "changed" && f.fields === undefined)
      ctx.addIssue({ code: "custom", path: ["fields"], message: "needed for impact changed" });
    if (f.impact === "removed" && f.fields !== undefined)
      ctx.addIssue({ code: "custom", path: ["fields"], message: "not allowed for impact removed" });
    if (f.impact === "changed" && f.candidates !== undefined)
      ctx.addIssue({ code: "custom", path: ["candidates"], message: "only for impact removed" });
  });
export type PatchFinding = z.infer<typeof PatchFinding>;

/**
 * Verdict of the revalidation of one stored guide revision against a newer data
 * release (F-19). Derived from the findings, never set by hand:
 * `broken` if any reference was removed, `needs-recalc` if any changed or any release fact
 * changed, else `unaffected`. If a diff of the chain is missing, there is no PatchStatus: the
 * check fails with an error instead (no silent `unaffected`).
 */
/**
 * Release facts a guide depends on that the CatalogDiff does not cover. A change in one of them
 * means the guide must be recalculated even if no entity changed.
 */
export const ReleaseFactChange = z.enum([
  "pobVersion",
  "maxCharacterLevel",
  "passivePoints",
  "itemSlots",
  "rarities",
  "classifications",
]);
export type ReleaseFactChange = z.infer<typeof ReleaseFactChange>;

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
    /**
     * The releases whose diffs were applied, in order, from `fromReleaseId` to `toReleaseId`
     * (each diff leads from one entry to the next). A removed and re-added entity counts as
     * changed or unchanged by comparing the first and the last release, not as removed.
     */
    chain: z.array(DataReleaseId).min(2),
    /** Release facts that differ between the first and the last release of the chain. */
    factChanges: z.array(ReleaseFactChange).default([]),
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
    if (s.chain[0] !== s.fromReleaseId || s.chain[s.chain.length - 1] !== s.toReleaseId)
      ctx.addIssue({
        code: "custom",
        path: ["chain"],
        message: "must start at fromReleaseId and end at toReleaseId",
      });
    if (new Set(s.chain).size !== s.chain.length)
      ctx.addIssue({ code: "custom", path: ["chain"], message: "lists a release twice" });
    if (new Set(s.factChanges).size !== s.factChanges.length)
      ctx.addIssue({ code: "custom", path: ["factChanges"], message: "lists a fact twice" });
    const expected: PatchVerdict = s.findings.some((f) => f.impact === "removed")
      ? "broken"
      : s.findings.length > 0 || s.factChanges.length > 0
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

/**
 * Error codes of `guide.revalidate`. The tool answers with exactly one of these as a tool error
 * (never with a PatchStatus) when the check cannot be made.
 */
export const GuideRevalidateErrorCode = z.enum([
  /** No stored guide with this id. */
  "guide_not_found",
  /** The release is not in the server's data directory. */
  "release_unknown",
  /** The release is the guide's own or older than it. */
  "release_not_newer",
  /** A release of the chain has no diff against its predecessor, or the chain has a gap. */
  "diff_missing",
  /** The stored guide does not match the contract of this version. */
  "guide_invalid",
]);
export type GuideRevalidateErrorCode = z.infer<typeof GuideRevalidateErrorCode>;

/**
 * MCP tool of F-19. Only ids go in: the server looks the guide up in its own store and the
 * releases in its own data directory, so no path ever comes from a client.
 */
export const GuideTools = {
  "guide.revalidate": {
    description:
      "Checks a stored guide against a newer data release: which catalog references were removed or changed, which stages they affect, and whether the guide needs a recalculation. The newest stored revision of the guide is checked (`PatchStatus.guideRevision` says which). Never answers 'unaffected' when the check cannot be made; it fails with one of GuideRevalidateErrorCode instead.",
    input: z.object({
      guideId: z.uuid(),
      /** A release newer than the one the guide was built with; the server rejects any other with `release_not_newer`. */
      toReleaseId: DataReleaseId,
    }),
    output: PatchStatus,
  },
} as const;
export type GuideToolName = keyof typeof GuideTools;
