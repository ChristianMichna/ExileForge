import { PriceBook } from "@exileforge/contracts";
import type { PriceQuote } from "@exileforge/contracts";
import type { EconomyConfig, ItemMap } from "./config.js";
import { EconomyError } from "./errors.js";
import type { ExchangeOverviewResponse } from "./provider.js";

export interface BuildBookInput {
  config: EconomyConfig;
  itemMap: ItemMap;
  /** True if the catalog of the data release has this entity. */
  catalogHas: (kind: "baseItem" | "uniqueItem", id: string) => boolean;
  dataReleaseId: PriceBook["dataReleaseId"];
  league: string;
  fetchedAt: string;
  /** One response per requested exchange type. */
  responses: readonly ExchangeOverviewResponse[];
}

function confidenceOf(
  volume: number | undefined,
  c: EconomyConfig["confidence"],
): PriceQuote["confidence"] {
  if (volume === undefined) return "low";
  if (volume >= c.high) return "high";
  if (volume >= c.medium) return "medium";
  return "low";
}

/**
 * Turns provider responses into a price book in catalog ids. Provider ids
 * without a (valid) catalog id are listed in `unmappedProviderItemIds`, as are
 * lines with an unusable price (not a finite number above 0) and repeated
 * lines for the same catalog item; nothing is dropped silently.
 */
export function buildPriceBook(input: BuildBookInput): PriceBook {
  const { config, itemMap, catalogHas, responses } = input;
  const primaries = new Set(responses.map((r) => r.core.primary));
  const [primary] = primaries;
  if (primary === undefined || primaries.size !== 1) {
    throw new EconomyError(
      "invalid_response",
      `exchange responses disagree on the reference currency: ${[...primaries].join(", ") || "none"}`,
    );
  }
  const reference = itemMap.items[primary];
  if (reference?.kind !== "baseItem" || !catalogHas("baseItem", reference.id)) {
    throw new EconomyError(
      "reference_currency_unmapped",
      `reference currency "${primary}" of the provider has no catalog id in config/economy/item-map.json`,
    );
  }

  const quotes = new Map<string, PriceQuote>();
  const unmapped = new Set<string>();
  for (const response of responses) {
    for (const line of response.lines) {
      const target = itemMap.items[line.id];
      if (!target || !catalogHas(target.kind, target.id)) {
        unmapped.add(line.id);
        continue;
      }
      if (!Number.isFinite(line.primaryValue) || line.primaryValue <= 0) {
        unmapped.add(line.id);
        continue;
      }
      const key = `${target.kind}:${target.id}`;
      if (quotes.has(key)) {
        unmapped.add(line.id);
        continue;
      }
      quotes.set(key, {
        item: { kind: target.kind, id: target.id },
        providerItemId: line.id,
        amount: line.primaryValue,
        ...(line.volumePrimaryValue !== undefined ? { volume: line.volumePrimaryValue } : {}),
        confidence: confidenceOf(line.volumePrimaryValue, config.confidence),
      } as PriceQuote);
    }
  }
  // The reference currency has no quote of its own; it is the unit.
  quotes.delete(`baseItem:${reference.id}`);

  return PriceBook.parse({
    provider: config.provider,
    league: input.league,
    dataReleaseId: input.dataReleaseId,
    fetchedAt: input.fetchedAt,
    referenceCurrencyItemId: reference.id,
    quotes: [...quotes.values()],
    unmappedProviderItemIds: [...unmapped].sort(),
  });
}
