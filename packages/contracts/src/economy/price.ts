import { z } from "zod";
import { BaseItemId, UniqueItemId } from "../common/ids.js";
import { DataReleaseId, IsoDateTime } from "../common/version.js";
import { MeasuredPrice } from "../build/stages.js";

/*
 * Market prices (F-14). Prices are never read from the model's memory: they
 * come from the economy provider configured in config/economy, are cached
 * locally and always carry provider, league, fetch time and confidence.
 * Prices are `market` numbers; a missing price is "uncalibrated", a failed
 * fetch is "failed" – never 0 and never an old value without a flag.
 */

/** League name as the provider reports it; leagues are not hard-coded. */
export const EconomyLeague = z.string().min(1).max(128);
export type EconomyLeague = z.infer<typeof EconomyLeague>;

/** Something that has a market price: a base item (currencies, bases) or a unique. */
export const PricedItemRef = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("baseItem"), id: BaseItemId }),
  z.object({ kind: z.literal("uniqueItem"), id: UniqueItemId }),
]);
export type PricedItemRef = z.infer<typeof PricedItemRef>;

/** One price in terms of the price book's reference currency. */
export const PriceQuote = z.object({
  /** Catalog entity the price is for. */
  item: PricedItemRef,
  /** The provider's own id, kept for tracing a quote back to the response. */
  providerItemId: z.string().min(1),
  /** Amount of the reference currency for one unit of the item. */
  amount: z.number().positive(),
  /** Offers or traded volume as the provider reports it; absent if it does not. */
  volume: z.number().nonnegative().optional(),
  confidence: z.enum(["high", "medium", "low"]),
});
export type PriceQuote = z.infer<typeof PriceQuote>;

/** All prices of one league fetched in one go; what the local cache stores. */
export const PriceBook = z
  .object({
    provider: z.string().min(1),
    league: EconomyLeague,
    /** Release whose catalog ids the mapping from provider ids targets. */
    dataReleaseId: DataReleaseId,
    fetchedAt: IsoDateTime,
    /** Currency the quotes are expressed in (catalog id). */
    referenceCurrencyItemId: BaseItemId,
    quotes: z.array(PriceQuote),
    /** Provider ids that have no catalog id in config/economy; listed, not dropped. */
    unmappedProviderItemIds: z.array(z.string().min(1)).default([]),
  })
  .superRefine((b, ctx) => {
    const seen = new Set<string>();
    b.quotes.forEach((q, i) => {
      const key = `${q.item.kind}:${q.item.id}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: ["quotes", i, "item"], message: "duplicate quote" });
      }
      seen.add(key);
    });
  });
export type PriceBook = z.infer<typeof PriceBook>;

/** Price of one item as a measured value with its market source. */
export const ItemPrice = z.object({
  item: PricedItemRef,
  price: MeasuredPrice,
});
export type ItemPrice = z.infer<typeof ItemPrice>;

/** Upper bound of items per economy.price call (contract limit). */
export const MAX_PRICE_ITEMS = 200;

export const EconomyTools = {
  "economy.price": {
    description:
      "Current market price of catalog items in one currency item, with provider, league, fetch time and confidence. Missing prices are reported as uncalibrated, never guessed.",
    input: z.object({
      /** Absent = the current league from the economy config. */
      league: EconomyLeague.optional(),
      /** At most MAX_PRICE_ITEMS entries. */
      items: z.array(PricedItemRef).min(1).max(MAX_PRICE_ITEMS),
      /** Currency item the prices are given in; absent = the config's display currency. */
      inCurrencyItemId: BaseItemId.optional(),
    }),
    /** One entry per requested item, in request order; league and currency are those actually used. */
    output: z.object({
      league: EconomyLeague,
      inCurrencyItemId: BaseItemId,
      prices: z.array(ItemPrice),
      /** When the price book was fetched. */
      fetchedAt: IsoDateTime,
      /** "stale": the refresh failed and an older book was used; `refreshError` says why. */
      freshness: z.enum(["fresh", "stale"]),
      refreshError: z.object({ code: z.string().min(1), message: z.string().min(1) }).optional(),
    }),
  },
} as const;
export type EconomyToolName = keyof typeof EconomyTools;
