import type { BuildFileResolvers } from "@astrolabe/exporters";
import type { CatalogPort } from "../ports/catalog.js";

/** String field of a catalog entity, or undefined when absent or not a non-empty string. */
function textField(entity: unknown, key: string): string | undefined {
  const value = (entity as Record<string, unknown> | null)?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The game's ids and names for the `.build` export, read from the loaded data release. Whatever
 * the release does not carry stays undefined, so the exporter lists it as omitted instead of
 * inventing it.
 */
export function buildFileResolvers(catalog: CatalogPort): BuildFileResolvers {
  const slots = new Map(
    (catalog.release?.itemSlots?.slots ?? []).map((slot) => [slot.id, slot.gameId] as const),
  );
  const rarities = new Map(
    (catalog.release?.rarities?.rarities ?? []).map((r) => [r.id, r.name] as const),
  );
  return {
    passiveGameId: (nodeId) =>
      textField(catalog.get({ kind: "passiveNode", id: nodeId })?.entity, "gameId"),
    slotGameId: (slotId) => slots.get(slotId),
    uniqueName: (uniqueId) => catalog.get({ kind: "uniqueItem", id: uniqueId })?.name,
    // The game names an ascendancy by its id ("Druid1"); the entry must exist in the release.
    ascendancyName: (ascendancyId) => catalog.get({ kind: "ascendancy", id: ascendancyId })?.id,
    rarityName: (rarityId) => rarities.get(rarityId),
    entityName: (ref) => catalog.get(ref)?.name,
  };
}
