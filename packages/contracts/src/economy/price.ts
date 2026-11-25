import { z } from "zod";
import { BaseItemId } from "../common/ids.js";
import { IsoDateTime } from "../common/version.js";
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

/** One price in terms of the price book's reference currency. */
export const PriceQuote = z.object({
  /** Catalog id of the item the price is for. */
  itemId: BaseItemId,
  /** The provider's own id, kept for tracing a quote back to the response. */
  providerItemId: z.string().min(1),
  /** Amount of the reference currency for one unit of the item. */
  amount: z.number().nonnegative(),
  /** Offers or traded volume as the provider reports it; absent if it does not. */
  volume: z.number().nonnegative().optional(),
  confidence: z.enum(["high", "medium", "low"]),
});
export type PriceQuote = z.infer<typeof PriceQuote>;

/** All prices of one league fetched in one go; what the local cache stores. */
export const PriceBook = z.object({
  provider: z.string().min(1),
  league: EconomyLeague,
  fetchedAt: IsoDateTime,
  /** Currency the quotes are expressed in (catalog id). */
  referenceCurrencyItemId: BaseItemId,
  quotes: z.array(PriceQuote),
  /** Provider ids that have no catalog id in config/economy; listed, not dropped. */
  unmappedProviderItemIds: z.array(z.string().min(1)).default([]),
});
export type PriceBook = z.infer<typeof PriceBook>;

/** Price of one item as a measured value with its market source. */
export const ItemPrice = z.object({
  itemId: BaseItemId,
  price: MeasuredPrice,
});
export type ItemPrice = z.infer<typeof ItemPrice>;

export const EconomyTools = {
  "economy.price": {
    description:
      "Current market price of catalog items in one currency item, with provider, league, fetch time and confidence. Missing prices are reported as uncalibrated, never guessed.",
    input: z.object({
      /** Absent = the current league from the economy config. */
      league: EconomyLeague.optional(),
      itemIds: z.array(BaseItemId).min(1).max(200),
      /** Currency item the prices are given in; absent = the config's display currency. */
      inCurrencyItemId: BaseItemId.optional(),
    }),
    output: z.object({ prices: z.array(ItemPrice) }),
  },
} as const;
export type EconomyToolName = keyof typeof EconomyTools;
