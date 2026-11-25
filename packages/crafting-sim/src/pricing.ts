import type { MarketSource, PriceBook, PrimarySource } from "@exileforge/contracts";

type Market = ReturnType<typeof MarketSource.parse>;
type Confidence = Market["confidence"];

const rank: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export function weakest(a: Confidence, b: Confidence): Confidence {
  return rank[a] <= rank[b] ? a : b;
}

/**
 * Price lookup in the book's reference currency. The reference currency itself
 * costs exactly 1 of itself (an identity, not a quote); anything without a
 * quote is unknown and reported by the caller, never priced at 0.
 */
export class PriceLookup {
  private readonly quotes = new Map<string, { amount: number; confidence: Confidence }>();
  private weakestUsed: Confidence | undefined;

  constructor(readonly book: PriceBook) {
    for (const q of book.quotes) {
      if (q.item.kind === "baseItem") this.quotes.set(q.item.id, q);
    }
  }

  /** Amount of the reference currency for one unit, or undefined if there is no price. */
  unitPrice(itemId: string): number | undefined {
    if (itemId === this.book.referenceCurrencyItemId) return 1;
    const quote = this.quotes.get(itemId);
    if (!quote) return undefined;
    this.weakestUsed = this.weakestUsed
      ? weakest(this.weakestUsed, quote.confidence)
      : quote.confidence;
    return quote.amount;
  }

  /** Market source covering all quotes read so far; undefined if only the reference currency was used. */
  usedSource(): PrimarySource | undefined {
    if (!this.weakestUsed) return undefined;
    return {
      kind: "market",
      provider: this.book.provider,
      league: this.book.league,
      fetchedAt: this.book.fetchedAt,
      confidence: this.weakestUsed,
    };
  }
}
