import type { BaseItem, CraftingAction, Mod } from "@exileforge/contracts";

/** What the simulator reads from a data release. */
export interface SimCatalog {
  baseItem(id: string): BaseItem | undefined;
  mod(id: string): Mod | undefined;
  action(id: string): CraftingAction | undefined;
  mods(): readonly Mod[];
}

export function createSimCatalog(entities: {
  baseItems: readonly BaseItem[];
  mods: readonly Mod[];
  actions: readonly CraftingAction[];
}): SimCatalog {
  const bases = new Map(entities.baseItems.map((b) => [b.id as string, b]));
  const mods = new Map(entities.mods.map((m) => [m.id as string, m]));
  const actions = new Map(entities.actions.map((a) => [a.id as string, a]));
  return {
    baseItem: (id) => bases.get(id),
    mod: (id) => mods.get(id),
    action: (id) => actions.get(id),
    mods: () => entities.mods,
  };
}
