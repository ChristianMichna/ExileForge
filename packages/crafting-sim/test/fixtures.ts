import type { BaseItem, CraftingAction, Mod, PriceBook } from "@astrolabe/contracts";
import {
  BaseItem as BaseItemSchema,
  CraftingAction as ActionSchema,
  Mod as ModSchema,
} from "@astrolabe/contracts";

/*
 * Synthetic fixtures with invented ids. They test the logic of the simulator
 * only; none of the numbers or names stands for real game data.
 */

export const RELEASE = "poe2-0.0.1+r1";

export const base: BaseItem = BaseItemSchema.parse({
  id: "base-alpha",
  name: "Alpha Base",
  itemClass: "class-x",
  tags: ["tag-alpha", "tag-any"],
  requirements: {},
  implicitModIds: [],
  properties: {},
});

export function mod(
  id: string,
  weight: number,
  opts: { gen?: string; groups?: string[]; level?: number; tag?: string } = {},
): Mod {
  return ModSchema.parse({
    id,
    groups: opts.groups ?? [`group-${id}`],
    generationType: opts.gen ?? "gen-p",
    domains: ["domain-item"],
    requiredLevel: opts.level ?? 1,
    stats: [],
    spawnWeights: [
      { tag: opts.tag ?? "tag-alpha", weight },
      { tag: "tag-any", weight: 0 },
    ],
  });
}

export function action(
  id: string,
  effects: { op: string; params: Record<string, unknown> }[],
  opts: { itemId?: string; preconditions?: { op: string; params: Record<string, unknown> }[] } = {},
): CraftingAction {
  return ActionSchema.parse({
    id,
    name: id,
    kind: "kind-x",
    ...(opts.itemId ? { itemId: opts.itemId } : {}),
    preconditions: opts.preconditions ?? [],
    effects,
  });
}

export const addOne = (limit = 1, gens = ["gen-p"]) => ({
  op: "add-random-mod",
  params: {
    generationTypes: gens,
    limits: Object.fromEntries(gens.map((g) => [g, limit])),
    domain: "domain-item",
  },
});

export const book: PriceBook = {
  provider: "test-provider",
  league: "TestLeague",
  dataReleaseId: RELEASE as PriceBook["dataReleaseId"],
  fetchedAt: "2026-11-25T00:00:00Z",
  referenceCurrencyItemId: "cur-ref" as PriceBook["referenceCurrencyItemId"],
  quotes: [
    {
      item: { kind: "baseItem", id: "cur-add" as never },
      providerItemId: "p1",
      amount: 2,
      confidence: "high",
    },
    {
      item: { kind: "baseItem", id: "cur-big" as never },
      providerItemId: "p2",
      amount: 10,
      confidence: "medium",
    },
  ],
  unmappedProviderItemIds: [],
};
