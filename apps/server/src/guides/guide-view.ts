import { CalcResult } from "@astrolabe/contracts/calc";
import { CalcId } from "@astrolabe/contracts/common";
import type { GuideView, PublishedGuide } from "@astrolabe/contracts/guide";
import { collectGuideRefs } from "@astrolabe/revalidate";
import type { CalcPort } from "../ports/calc.js";
import type { CatalogPort } from "../ports/catalog.js";

/** Every value of a field named `calcId` anywhere in the guide (calc segments, outcomes, sources). */
function collectCalcIds(guide: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== "object" || node === null) return;
    for (const [field, value] of Object.entries(node)) {
      if (field === "calcId" && typeof value === "string" && value !== "") found.add(value);
      else walk(value);
    }
  };
  walk(guide);
  return [...found];
}

/**
 * The guide with the names of the entities it refers to and the stored results behind its
 * numbers. A name or result that is not available stays absent and is listed in `unresolved`.
 * A guide of another data release gets no names at all (an id can mean something else there);
 * a stored result that is not a valid result any more is listed, never passed on.
 */
export async function buildGuideView(
  guide: PublishedGuide,
  catalog: CatalogPort,
  calc: CalcPort,
): Promise<GuideView> {
  const current = guide.metadata.dataReleaseId === catalog.dataReleaseId;
  const unresolved = new Set<string>();
  const names: Record<string, string> = {};
  for (const ref of collectGuideRefs(guide)) {
    const key = `${ref.kind}:${ref.id}`;
    if (key in names || unresolved.has(key)) continue;
    const name = current ? catalog.get({ kind: ref.kind, id: ref.id })?.name : undefined;
    if (name === undefined) unresolved.add(key);
    else names[key] = name;
  }
  const loaded = await Promise.all(
    collectCalcIds(guide).map(async (raw) => {
      const calcId = CalcId.safeParse(raw);
      if (!calcId.success) return { raw, result: undefined };
      return { raw, result: await calc.getResult(calcId.data) };
    }),
  );
  const results: Record<string, CalcResult> = {};
  for (const { raw, result } of loaded) {
    const valid = CalcResult.safeParse(result);
    if (valid.success) results[raw] = valid.data;
    else unresolved.add(`calc:${raw}`);
  }
  return {
    guide,
    catalogReleaseId: catalog.dataReleaseId,
    current,
    names,
    results,
    unresolved: [...unresolved],
  };
}
