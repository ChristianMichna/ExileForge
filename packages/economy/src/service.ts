import type { PriceBook, PricedItemRef } from "@exileforge/contracts";
import { PriceBook as PriceBookSchema } from "@exileforge/contracts";
import { buildPriceBook } from "./book.js";
import type { BookStore } from "./cache.js";
import type { PoeNinjaClient } from "./client.js";
import type { EconomyConfig, ItemMap } from "./config.js";
import { EconomyError } from "./errors.js";
import { priceItems } from "./price.js";

export interface EconomyServiceDeps {
  config: EconomyConfig;
  itemMap: ItemMap;
  client: Pick<PoeNinjaClient, "leagues" | "exchangeOverview">;
  books: BookStore;
  /** The data release the app currently works with. */
  dataReleaseId: PriceBook["dataReleaseId"];
  catalogHas: (kind: "baseItem" | "uniqueItem", id: string) => boolean;
  now?: () => Date;
}

export interface BookResult {
  book: PriceBook;
  /** "stale": the refresh failed and this is the last stored book; `refreshError` says why. */
  freshness: "fresh" | "stale";
  refreshError?: EconomyError;
}

export class EconomyService {
  private readonly now: () => Date;
  constructor(private readonly deps: EconomyServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** League of the request, or the provider's current challenge league (first entry of its list). */
  async resolveLeague(league?: string): Promise<string> {
    if (league) return league;
    const leagues = await this.deps.client.leagues();
    const first = leagues[0];
    if (!first) throw new EconomyError("no_league", "the provider lists no league");
    return first.id;
  }

  /**
   * The price book of a league: from the local store if younger than the
   * configured TTL, else fetched. If the fetch fails and an older book exists
   * it is returned as "stale" with the error; with no book the error is thrown.
   */
  async getBook(league?: string): Promise<BookResult> {
    const { config, books, dataReleaseId } = this.deps;
    const name = await this.resolveLeague(league);
    const stored = await books.get(name, dataReleaseId);
    if (stored) {
      const ageMinutes = (this.now().getTime() - Date.parse(stored.fetchedAt)) / 60_000;
      if (ageMinutes >= 0 && ageMinutes < config.cacheTtlMinutes) {
        return { book: stored, freshness: "fresh" };
      }
    }
    try {
      const book = await this.refresh(name);
      return { book, freshness: "fresh" };
    } catch (error) {
      if (stored && error instanceof EconomyError) {
        return { book: stored, freshness: "stale", refreshError: error };
      }
      throw error;
    }
  }

  async refresh(league: string): Promise<PriceBook> {
    const { config, client, books } = this.deps;
    const responses = [];
    for (const type of config.exchangeTypes) {
      responses.push(await client.exchangeOverview(league, type));
    }
    const book = buildPriceBook({
      config,
      itemMap: this.deps.itemMap,
      catalogHas: this.deps.catalogHas,
      dataReleaseId: this.deps.dataReleaseId,
      league,
      fetchedAt: this.now().toISOString(),
      responses,
    });
    await books.set(PriceBookSchema.parse(book));
    return book;
  }

  /** `economy.price`: output of the contract tool. */
  async price(input: {
    league?: string | undefined;
    items: readonly PricedItemRef[];
    inCurrencyItemId?: PriceBook["referenceCurrencyItemId"] | undefined;
  }) {
    const result = await this.getBook(input.league);
    const priced = priceItems(result.book, input.items, input.inCurrencyItemId);
    return { league: result.book.league, ...priced, freshness: result.freshness };
  }
}
