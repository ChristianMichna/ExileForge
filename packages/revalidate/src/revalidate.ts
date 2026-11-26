import {
  PATCH_STATUS_SCHEMA_VERSION,
  PatchStatus,
  type CatalogDiff,
  type DataRelease,
  type FieldChange,
  type PatchFinding,
  type ReleaseFactChange,
} from "@astrolabe/contracts";
import { collectGuideRefs, type GuideRef } from "./refs.js";

/** The check cannot be made (for example a gap in the chain). Never answered with `unaffected`. */
export class RevalidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RevalidationError";
  }
}

/** The parts of a data release that are compared as facts. */
export type ReleaseFacts = Pick<
  DataRelease,
  | "id"
  | "pobVersion"
  | "maxCharacterLevel"
  | "passivePoints"
  | "itemSlots"
  | "rarities"
  | "classifications"
>;

export interface RevalidateInput {
  /** A parsed GuideDocument (any later revision of the same layout works too). */
  guide: {
    metadata: { guideId: string; revision: number; dataReleaseId: string };
  };
  /** Diffs in order: from the guide's release to the checked one, each starting where the last ended. */
  diffs: readonly CatalogDiff[];
  /** The release facts of the guide's release and of the checked release. */
  facts: { from: ReleaseFacts; to: ReleaseFacts };
  checkedAt: string;
}

/** Canonical JSON text, independent of key order, to compare facts and field values. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object" && v !== null)
    return `{${Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(",")}}`;
  return v === undefined ? "undefined" : JSON.stringify(v);
}

const FACT_KEYS: readonly ReleaseFactChange[] = [
  "pobVersion",
  "maxCharacterLevel",
  "passivePoints",
  "itemSlots",
  "rarities",
  "classifications",
];

export function changedFacts(from: ReleaseFacts, to: ReleaseFacts): ReleaseFactChange[] {
  return FACT_KEYS.filter((k) => canonical(from[k]) !== canonical(to[k]));
}

type Fate =
  { state: "removed" } | { state: "changed"; fields: Map<string, FieldChange>; readded: boolean };

/** What the diffs of the chain did to each entity they mention, composed in order. */
function composeFates(diffs: readonly CatalogDiff[]): Map<string, Fate> {
  const fates = new Map<string, Fate>();
  for (const diff of diffs) {
    for (const [kind, kd] of Object.entries(diff.kinds)) {
      if (!kd) continue;
      const key = (id: string) => `${kind}:${id}`;
      for (const id of kd.removed) fates.set(key(id), { state: "removed" });
      for (const id of kd.added) {
        // gone earlier in the chain and back now: the entities cannot be compared, so it counts as changed
        if (fates.get(key(id))?.state === "removed")
          fates.set(key(id), { state: "changed", fields: new Map(), readded: true });
      }
      for (const c of kd.changed) {
        const prev = fates.get(key(c.id));
        if (prev?.state === "removed")
          throw new RevalidationError(
            `${kind} ${c.id} is changed in ${diff.to} after it was removed; the chain of diffs does not fit together`,
          );
        const fields = prev?.state === "changed" ? prev.fields : new Map<string, FieldChange>();
        for (const f of c.fields) {
          const before = fields.has(f.path) ? fields.get(f.path)?.before : f.before;
          fields.set(f.path, {
            path: f.path,
            ...(before !== undefined ? { before } : {}),
            ...(f.after !== undefined ? { after: f.after } : {}),
          });
        }
        fates.set(key(c.id), {
          state: "changed",
          fields,
          readded: prev?.state === "changed" && prev.readded,
        });
      }
    }
  }
  return fates;
}

/**
 * Checks every catalog reference of a stored guide against the diffs between its release and a
 * newer one (F-19). The verdict comes from the findings and the changed release facts; a diff
 * that does not fit the guide's release is an error, not `unaffected`.
 */
export function revalidateGuide(input: RevalidateInput): PatchStatus {
  const { guide, diffs } = input;
  const first = diffs[0];
  if (!first) throw new RevalidationError("no diff given; there is nothing to check against");
  if (first.from !== guide.metadata.dataReleaseId)
    throw new RevalidationError(
      `the first diff starts at ${first.from}, but the guide was built with ${guide.metadata.dataReleaseId}`,
    );
  const chain = [first.from];
  for (const d of diffs) {
    if (d.from !== chain[chain.length - 1])
      throw new RevalidationError(
        `the diffs do not form a chain: ${d.from} does not follow ${chain.at(-1)}`,
      );
    chain.push(d.to);
  }
  if (new Set(chain).size !== chain.length)
    throw new RevalidationError(`the diffs lead through a release twice: ${chain.join(" -> ")}`);
  const last = chain[chain.length - 1];
  if (input.facts.from.id !== first.from || input.facts.to.id !== last)
    throw new RevalidationError(
      `the release facts (${input.facts.from.id}, ${input.facts.to.id}) do not belong to the chain ends (${first.from}, ${String(last)})`,
    );
  const fates = composeFates(diffs);
  const refs = collectGuideRefs(guide);
  if (!refs.some((r) => r.location.startsWith("/progression/")))
    throw new RevalidationError(
      "no reference found in /progression; this is not a GuideDocument of the supported layout, so it cannot be called unaffected",
    );

  const byEntity = new Map<string, GuideRef[]>();
  for (const r of refs) {
    const k = `${r.kind}:${r.id}`;
    byEntity.set(k, [...(byEntity.get(k) ?? []), r]);
  }

  const findings: PatchFinding[] = [];
  for (const [k, uses] of byEntity) {
    const fate = fates.get(k);
    const [u] = uses;
    if (!fate || !u) continue;
    const base = {
      ref: { kind: u.kind, id: u.id },
      locations: uses.map((x) => x.location),
      stageIds: [...new Set(uses.flatMap((x) => (x.stageKey ? [x.stageKey] : [])))],
    };
    if (fate.state === "removed") {
      findings.push({ ...base, impact: "removed" });
      continue;
    }
    const fields = fate.readded
      ? [{ path: "/" }]
      : [...fate.fields.values()].filter((f) => canonical(f.before) !== canonical(f.after));
    if (fields.length > 0) findings.push({ ...base, impact: "changed", fields });
  }

  const factChanges = changedFacts(input.facts.from, input.facts.to);
  const verdict = findings.some((f) => f.impact === "removed")
    ? "broken"
    : findings.length > 0 || factChanges.length > 0
      ? "needs-recalc"
      : "unaffected";
  return PatchStatus.parse({
    schemaVersion: PATCH_STATUS_SCHEMA_VERSION,
    guideId: guide.metadata.guideId,
    guideRevision: guide.metadata.revision,
    fromReleaseId: first.from,
    toReleaseId: chain[chain.length - 1],
    chain,
    factChanges,
    checkedAt: input.checkedAt,
    checkedReferences: byEntity.size,
    verdict,
    findings,
  });
}
