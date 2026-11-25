import type { z } from "zod";
import type { BuildState, Finding, RichText } from "@exileforge/contracts/build";
import type { CalcProfileId, DataReleaseId, EntityRef } from "@exileforge/contracts/common";
import type { CalcPort } from "../ports/calc.js";
import type { CatalogPort } from "../ports/catalog.js";

/** Converts schema issues into findings with JSON pointers into the payload. */
export function schemaFindings(error: z.ZodError): Finding[] {
  return error.issues.slice(0, 20).map((issue) => ({
    gate: "schema",
    severity: "error",
    code: "schema_mismatch",
    message: issue.message,
    path: toPointer(issue.path),
  }));
}

/** Gate G1: every referenced id must exist in the catalog of the run's data release. */
export function entityFindings(
  catalog: CatalogPort,
  refs: readonly { path: string; ref: EntityRef }[],
): Finding[] {
  return refs
    .filter(({ ref }) => catalog.get(ref) === undefined)
    .map(({ path, ref }) => ({
      gate: "G1",
      severity: "error",
      code: "unknown_entity",
      message: `Unknown ${ref.kind} id ${JSON.stringify(ref.id)} in data release ${catalog.dataReleaseId}. Use catalog_search to find a valid id; never guess ids.`,
      path,
      entity: ref,
    }));
}

const DIGIT = /\p{Nd}/u;

/**
 * Numbers in LLM text: `text` segments may not contain digits (every number
 * must be a `calc` segment pointing at a PoB result), and every calc
 * reference must exist and name a stat of that result.
 */
export async function richTextFindings(
  calc: CalcPort,
  texts: readonly { path: string; text: RichText }[],
  scope?: {
    dataReleaseId: DataReleaseId;
    calcProfiles: readonly CalcProfileId[];
    /** The run's calc overrides; a result calculated with others is another situation. */
    overrides: Readonly<Record<string, boolean | number | string>>;
  },
): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const { path, text } of texts) {
    for (const [i, segment] of text.entries()) {
      const segPath = `${path}/${i}`;
      if (segment.type === "text" && DIGIT.test(segment.text)) {
        findings.push({
          gate: "G8",
          severity: "error",
          code: "free_number",
          message:
            "Text contains a number. Numbers are never typed: use a calc segment that references a calculation result, or rephrase without the number.",
          path: segPath,
        });
      }
      if (segment.type === "calc") {
        const result = await calc.getResult(segment.ref.calcId);
        const inScope =
          result !== undefined &&
          (scope === undefined ||
            (result.dataReleaseId === scope.dataReleaseId &&
              scope.calcProfiles.includes(result.calcProfile) &&
              sameOverrides(result.overrides ?? {}, scope.overrides)));
        if (result === undefined || !inScope || !(segment.ref.stat in result.stats)) {
          findings.push({
            gate: "G2",
            severity: "error",
            code: "unknown_calc_ref",
            message: `Calc reference ${segment.ref.calcId}/${segment.ref.stat} does not exist for this run's data release, calc profiles and calc overrides. Only reference calcIds and stats returned by the engine for this run.`,
            path: segPath,
            calcId: segment.ref.calcId,
          });
        }
      }
    }
  }
  return findings;
}

export function toPointer(path: readonly PropertyKey[]): string {
  return `/${path.map((p) => String(p).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

/** Every catalog reference of a build state, with JSON pointers (for G1). */
export function stateEntities(state: BuildState): { path: string; ref: EntityRef }[] {
  const refs: { path: string; ref: EntityRef }[] = [
    { path: "/classId", ref: { kind: "characterClass", id: state.classId } },
  ];
  if (state.ascendancyId !== undefined) {
    refs.push({ path: "/ascendancyId", ref: { kind: "ascendancy", id: state.ascendancyId } });
  }
  state.tree.allocated.forEach((n, i) =>
    refs.push({ path: `/tree/allocated/${i}/nodeId`, ref: { kind: "passiveNode", id: n.nodeId } }),
  );
  state.tree.ascendancy.forEach((id, i) =>
    refs.push({ path: `/tree/ascendancy/${i}`, ref: { kind: "passiveNode", id } }),
  );
  state.skills.forEach((s, i) => {
    refs.push({ path: `/skills/${i}/gem/gemId`, ref: { kind: "gem", id: s.gem.gemId } });
    s.supports.forEach((g, j) =>
      refs.push({ path: `/skills/${i}/supports/${j}/gemId`, ref: { kind: "gem", id: g.gemId } }),
    );
  });
  state.items.forEach(({ item }, i) => {
    const base = `/items/${i}/item`;
    if (item.kind === "unique") {
      refs.push({ path: `${base}/uniqueId`, ref: { kind: "uniqueItem", id: item.uniqueId } });
      return;
    }
    refs.push({ path: `${base}/baseItemId`, ref: { kind: "baseItem", id: item.baseItemId } });
    item.mods.forEach((m, j) =>
      refs.push({ path: `${base}/mods/${j}/modId`, ref: { kind: "mod", id: m.modId } }),
    );
    item.socketables.forEach((s, j) =>
      refs.push({
        path: `${base}/socketables/${j}/id`,
        ref: { kind: s.kind === "baseItem" ? "baseItem" : "craftingAction", id: s.id },
      }),
    );
  });
  return refs;
}

function sameOverrides(
  a: Readonly<Record<string, boolean | number | string>>,
  b: Readonly<Record<string, boolean | number | string>>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && a[k] === b[k])
  );
}
