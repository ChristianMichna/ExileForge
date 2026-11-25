import type { PriceBook, PricedItemRef } from "@astrolabe/contracts";
import { PriceBook as PriceBookSchema } from "@astrolabe/contracts";
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
  /** Problems that did not stop the result, e.g. a fresh book that could not be stored. */
  warnings: EconomyError[];
}

export class EconomyService {
  private readonly now: () => Date;
  private readonly inFlight = new Map<
    string,
    Promise<{ book: PriceBook; warnings: EconomyError[] }>
  >();

  constructor(private readonly deps: EconomyServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * League of the request, or else the provider's current challenge league
   * (the first entry of its list, as its docs describe). If the list cannot be
   * fetched, the league of the last stored book is used and the result is
   * marked stale by the caller.
   */
  private async resolveLeague(
    league: string | undefined,
  ): Promise<{ league: string; error?: EconomyError }> {
    if (league) return { league };
    try {
      const first = (await this.deps.client.leagues())[0];
      if (!first) throw new EconomyError("no_league", "the provider lists no league");
      return { league: first.id };
    } catch (error) {
      const latest = await this.deps.books.latest(this.deps.dataReleaseId);
      if (latest && error instanceof EconomyError) return { league: latest.league, error };
      throw error;
    }
  }

  /**
   * The price book of a league: from the local store if younger than the
   * configured TTL, else fetched. If the fetch fails and an older book exists
   * it is returned as "stale" with the error; with no book the error is thrown.
   */
  async getBook(league?: string): Promise<BookResult> {
    const { config, books, dataReleaseId } = this.deps;
    const resolved = await this.resolveLeague(league);
    const name = resolved.league;
    const stored = await books.get(name, dataReleaseId);
    if (stored && !resolved.error) {
      const ageMinutes = (this.now().getTime() - Date.parse(stored.fetchedAt)) / 60_000;
      if (ageMinutes >= 0 && ageMinutes < config.cacheTtlMinutes) {
        return { book: stored, freshness: "fresh", warnings: [] };
      }
    }
    if (resolved.error) {
      if (!stored) throw resolved.error;
      return { book: stored, freshness: "stale", refreshError: resolved.error, warnings: [] };
    }
    try {
      return await this.refreshWithWarnings(name);
    } catch (error) {
      if (stored && error instanceof EconomyError) {
        return { book: stored, freshness: "stale", refreshError: error, warnings: [] };
      }
      throw error;
    }
  }

  /** Concurrent callers of the same league share one fetch, and its warnings. */
  private async refreshWithWarnings(league: string): Promise<BookResult> {
    let run = this.inFlight.get(league);
    if (!run) {
      run = this.fetchAndStore(league).finally(() => this.inFlight.delete(league));
      this.inFlight.set(league, run);
    }
    const { book, warnings } = await run;
    return { book, freshness: "fresh", warnings: [...warnings] };
  }

  async refresh(league: string): Promise<PriceBook> {
    return (await this.refreshWithWarnings(league)).book;
  }

  private async fetchAndStore(
    league: string,
  ): Promise<{ book: PriceBook; warnings: EconomyError[] }> {
    const { config, client, books } = this.deps;
    const startedAt = this.now().toISOString();
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
      fetchedAt: startedAt,
      responses,
    });
    if (book.quotes.length < config.minQuotes) {
      throw new EconomyError(
        "implausible_response",
        `only ${book.quotes.length} usable quotes (minimum ${config.minQuotes}), ${book.unmappedProviderItemIds.length} ids unmapped; the previous book is kept`,
      );
    }
    // A book that breaks the contract is a bug and fails loudly; only storing is allowed to fail softly.
    const valid = PriceBookSchema.parse(book);
    const warnings: EconomyError[] = [];
    try {
      await books.set(valid);
    } catch (error) {
      warnings.push(
        error instanceof EconomyError
          ? error
          : new EconomyError("cache_error", "price book could not be stored", { cause: error }),
      );
    }
    return { book, warnings };
  }

  /** `economy.price`: output of the contract tool. */
  async price(input: {
    league?: string | undefined;
    items: readonly PricedItemRef[];
    inCurrencyItemId?: PriceBook["referenceCurrencyItemId"] | undefined;
  }) {
    const result = await this.getBook(input.league);
    const priced = priceItems(result.book, input.items, input.inCurrencyItemId);
    return {
      league: result.book.league,
      ...priced,
      fetchedAt: result.book.fetchedAt,
      freshness: result.freshness,
      ...(result.refreshError
        ? { refreshError: { code: result.refreshError.code, message: result.refreshError.message } }
        : {}),
    };
  }
}
