import type { CalcResult } from "@astrolabe/contracts/calc";
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
 */
export async function buildGuideView(
  guide: PublishedGuide,
  catalog: CatalogPort,
  calc: CalcPort,
): Promise<GuideView> {
  const unresolved = new Set<string>();
  const names: Record<string, string> = {};
  for (const ref of collectGuideRefs(guide)) {
    const key = `${ref.kind}:${ref.id}`;
    if (key in names || unresolved.has(key)) continue;
    const name = catalog.get({ kind: ref.kind, id: ref.id })?.name;
    if (name === undefined) unresolved.add(key);
    else names[key] = name;
  }
  const results: Record<string, CalcResult> = {};
  for (const calcId of collectCalcIds(guide)) {
    const result = await calc.getResult(calcId as CalcResult["calcId"]);
    if (result === undefined) unresolved.add(`calc:${calcId}`);
    else results[calcId] = result;
  }
  return { guide, names, results, unresolved: [...unresolved] };
}
