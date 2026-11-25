import type { ItemPrice, PriceBook, PricedItemRef, PrimarySource } from "@astrolabe/contracts";

type MarketSourceT = Extract<PrimarySource, { kind: "market" }>;

type Confidence = "high" | "medium" | "low";

export const ECONOMY_FORMULA_VERSION = "1";

/** Price of one item in the reference currency, or why there is none. */
function unitOf(
  book: PriceBook,
  item: PricedItemRef,
): { amount: number; confidence: Confidence } | undefined {
  if (item.kind === "baseItem" && item.id === book.referenceCurrencyItemId) {
    return { amount: 1, confidence: "high" };
  }
  const quote = book.quotes.find((q) => q.item.kind === item.kind && q.item.id === item.id);
  return quote ? { amount: quote.amount, confidence: quote.confidence } : undefined;
}

/**
 * Prices of items in `inCurrencyItemId` (default: the book's reference
 * currency) as measured values. A direct quote in the reference currency is a
 * `market` number; anything converted through another currency is `derived`
 * from the market quotes it uses. No quote means "uncalibrated", never 0.
 * One entry per requested item, in request order.
 */
export function priceItems(
  book: PriceBook,
  items: readonly PricedItemRef[],
  inCurrencyItemId?: PriceBook["referenceCurrencyItemId"],
): { inCurrencyItemId: PriceBook["referenceCurrencyItemId"]; prices: ItemPrice[] } {
  const target = inCurrencyItemId ?? book.referenceCurrencyItemId;
  const targetUnit = unitOf(book, { kind: "baseItem", id: target });
  const market = (confidence: Confidence): MarketSourceT => ({
    kind: "market",
    provider: book.provider,
    league: book.league,
    fetchedAt: book.fetchedAt,
    confidence,
  });
  const targetIsReference = target === book.referenceCurrencyItemId;

  const prices = items.map((item): ItemPrice => {
    const unit = unitOf(book, item);
    if (!unit) {
      return {
        item,
        price: {
          status: "uncalibrated",
          reason: `no ${book.provider} price for ${item.kind} ${item.id} in league ${book.league}`,
        },
      };
    }
    if (!targetUnit) {
      return {
        item,
        price: {
          status: "uncalibrated",
          reason: `no ${book.provider} price for the target currency ${target} in league ${book.league}`,
        },
      };
    }
    const value = { amount: unit.amount / targetUnit.amount, currencyItemId: target };
    const itemIsReference = item.kind === "baseItem" && item.id === book.referenceCurrencyItemId;
    if (itemIsReference && targetIsReference) {
      // The unit in itself is no market quote; a source for it would be made up.
      return {
        item,
        price: {
          status: "uncalibrated",
          reason: `${item.id} is the reference currency of this price book; its price in itself is not a market quote`,
        },
      };
    }
    if (targetIsReference) {
      return { item, price: { status: "ok", value, source: market(unit.confidence) } };
    }
    const inputs: PrimarySource[] = [];
    if (!itemIsReference) inputs.push(market(unit.confidence));
    if (!targetIsReference) inputs.push(market(targetUnit.confidence));
    return {
      item,
      price: {
        status: "ok",
        value,
        source: {
          kind: "derived",
          formula: "economy.convert",
          formulaVersion: ECONOMY_FORMULA_VERSION,
          inputs: inputs as [PrimarySource, ...PrimarySource[]],
        },
      },
    };
  });
  return { inCurrencyItemId: target, prices };
}
