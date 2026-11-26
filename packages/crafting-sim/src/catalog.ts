import type { BaseItem, CraftingAction, DataRelease, Mod } from "@astrolabe/contracts";

/** A rarity of the release with its affix limits. */
export type SimRarity = NonNullable<DataRelease["rarities"]>["rarities"][number];

/** What the simulator reads from a data release. */
export interface SimCatalog {
  baseItem(id: string): BaseItem | undefined;
  mod(id: string): Mod | undefined;
  action(id: string): CraftingAction | undefined;
  mods(): readonly Mod[];
  /** The release's rarity with this id; undefined if the release lists none or not this one. */
  rarity(id: string): SimRarity | undefined;
  /** Whether the release lists rarities at all. */
  hasRarities(): boolean;
}

export function createSimCatalog(entities: {
  baseItems: readonly BaseItem[];
  mods: readonly Mod[];
  actions: readonly CraftingAction[];
  rarities?: readonly SimRarity[] | undefined;
}): SimCatalog {
  const bases = new Map(entities.baseItems.map((b) => [b.id as string, b]));
  const mods = new Map(entities.mods.map((m) => [m.id as string, m]));
  const actions = new Map(entities.actions.map((a) => [a.id as string, a]));
  return {
    baseItem: (id) => bases.get(id),
    mod: (id) => mods.get(id),
    action: (id) => actions.get(id),
    mods: () => entities.mods,
    rarity: (id) => entities.rarities?.find((r) => r.id === id),
    hasRarities: () => (entities.rarities?.length ?? 0) > 0,
  };
}
