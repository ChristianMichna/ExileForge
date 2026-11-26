import { CalcResult } from "@astrolabe/contracts/calc";
import { CalcId } from "@astrolabe/contracts/common";
import { BaseItem, Mod, UniqueItem } from "@astrolabe/contracts/catalog";
import type { ItemSpec } from "@astrolabe/contracts/build";
import type {
  GuideGearEntry,
  GuideItemCard,
  GuideItemLine,
  GuideView,
  PublishedGuide,
} from "@astrolabe/contracts/guide";
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

/** The item as the catalog describes it, or null where the catalog lacks it (listed in `unresolved`). */
function itemCard(
  spec: ItemSpec,
  catalog: CatalogPort,
  unresolved: Set<string>,
): GuideItemCard | null {
  const lookup = <T>(
    kind: "baseItem" | "uniqueItem" | "mod",
    id: string,
    schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  ): T | undefined => {
    const parsed = schema.safeParse(catalog.get({ kind, id })?.entity);
    if (parsed.success) return parsed.data;
    unresolved.add(`${kind}:${id}`);
    return undefined;
  };
  const line = (modId: string, extra: Partial<GuideItemLine> = {}): GuideItemLine => {
    const mod = lookup("mod", modId, Mod);
    return {
      modId,
      ...(mod?.text === undefined ? {} : { text: mod.text }),
      ...(mod === undefined ? {} : { generationType: mod.generationType }),
      ...(mod?.tier === undefined ? {} : { tier: mod.tier }),
      ...extra,
    };
  };
  if (spec.kind === "unique") {
    const unique = lookup("uniqueItem", spec.uniqueId, UniqueItem);
    const base = unique && lookup("baseItem", unique.baseItemId, BaseItem);
    if (unique === undefined || base === undefined) return null;
    const lines = unique.mods.filter(
      (m) =>
        spec.variantId === undefined ||
        m.variantIds === undefined ||
        m.variantIds.includes(spec.variantId),
    );
    return {
      kind: "unique",
      name: unique.name,
      baseName: base.name,
      itemClass: base.itemClass,
      implicits: base.implicitModIds.map((id) => line(id)),
      explicits: lines.map((m) => ({
        ...(m.modId === undefined ? {} : { modId: m.modId }),
        ...(m.text === undefined ? {} : { text: m.text }),
      })),
    };
  }
  const base = lookup("baseItem", spec.baseItemId, BaseItem);
  if (base === undefined) return null;
  const rarity = catalog.release?.rarities?.rarities.find((r) => r.id === spec.rarity);
  if (rarity === undefined) unresolved.add(`rarity:${spec.rarity}`);
  return {
    kind: "crafted",
    rarityId: spec.rarity,
    ...(rarity === undefined ? {} : { rarityName: rarity.name }),
    baseName: base.name,
    itemClass: base.itemClass,
    implicits: base.implicitModIds.map((id) => line(id)),
    explicits: spec.mods.map((m) => line(m.modId)),
  };
}

function gearEntries(
  guide: PublishedGuide,
  catalog: CatalogPort,
  current: boolean,
  unresolved: Set<string>,
): GuideGearEntry[] {
  const card = (spec: ItemSpec): GuideItemCard | null =>
    current ? itemCard(spec, catalog, unresolved) : null;
  return guide.gear.tiers.flatMap((tier) =>
    tier.slots.map((slot) => {
      const minimum = slot.minimum === undefined ? undefined : card(slot.minimum);
      return {
        budgetTier: tier.budgetTier,
        slot: slot.slot,
        target: card(slot.target),
        ...(minimum === undefined ? {} : { minimum }),
        alternatives: slot.alternatives.map(card),
      };
    }),
  );
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
    if (valid.success && valid.data.calcId === raw) results[raw] = valid.data;
    else unresolved.add(`calc:${raw}`);
  }
  const gear = gearEntries(guide, catalog, current, unresolved);
  return {
    guide,
    catalogReleaseId: catalog.dataReleaseId,
    current,
    gear,
    names,
    results,
    unresolved: [...unresolved],
  };
}
