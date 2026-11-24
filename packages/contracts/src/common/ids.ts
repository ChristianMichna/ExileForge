import { z } from "zod";

/**
 * Catalog IDs are the game's internal IDs (e.g. a BaseItemTypes path or a
 * PassiveSkills id) – the same IDs the in-game `.build` format uses. They are
 * branded per entity kind so a gem id can never be passed where a mod id is
 * expected. Values are never invented by code: they come from a data release.
 */
const catalogId = <B extends string>(brand: B, what: string) =>
  z
    .string()
    .min(1)
    .max(512)
    .describe(`${what} – internal game id from the data release`)
    .brand<B>();

export const BaseItemId = catalogId("BaseItemId", "Base item type id");
export type BaseItemId = z.infer<typeof BaseItemId>;

export const ModId = catalogId("ModId", "Mod id");
export type ModId = z.infer<typeof ModId>;

export const UniqueItemId = catalogId("UniqueItemId", "Unique item id");
export type UniqueItemId = z.infer<typeof UniqueItemId>;

export const GemId = catalogId("GemId", "Gem id");
export type GemId = z.infer<typeof GemId>;

export const PassiveNodeId = catalogId("PassiveNodeId", "Passive skill id");
export type PassiveNodeId = z.infer<typeof PassiveNodeId>;

export const CharacterClassId = catalogId("CharacterClassId", "Character class id");
export type CharacterClassId = z.infer<typeof CharacterClassId>;

export const AscendancyId = catalogId("AscendancyId", "Ascendancy id");
export type AscendancyId = z.infer<typeof AscendancyId>;

export const CraftingActionId = catalogId("CraftingActionId", "Crafting action id");
export type CraftingActionId = z.infer<typeof CraftingActionId>;

export const StatId = catalogId("StatId", "Stat id");
export type StatId = z.infer<typeof StatId>;

export const StatTranslationId = catalogId("StatTranslationId", "Stat translation id");
export type StatTranslationId = z.infer<typeof StatTranslationId>;

/**
 * Open classification ids (item class, mod generation type, gem kind, node
 * kind, tag …). They are data, not enums: a patch may add new values without a
 * code release.
 */
export const ClassificationId = z
  .string()
  .min(1)
  .max(256)
  .describe("Classification id defined by the data release (not a fixed enum)");
export type ClassificationId = z.infer<typeof ClassificationId>;

export const EntityKind = z
  .enum([
    "baseItem",
    "mod",
    "uniqueItem",
    "gem",
    "passiveNode",
    "characterClass",
    "ascendancy",
    "craftingAction",
    "statTranslation",
  ])
  .describe("Kind of catalog entity (ExileForge's own grouping, not a game concept)");
export type EntityKind = z.infer<typeof EntityKind>;

/** Untyped reference to any catalog entity, e.g. for findings and diffs. */
export const EntityRef = z.object({
  kind: EntityKind,
  id: z.string().min(1).max(512),
});
export type EntityRef = z.infer<typeof EntityRef>;
