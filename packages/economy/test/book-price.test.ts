import { describe, expect, it } from "vitest";
import { ItemPrice, PricedItemRef } from "@astrolabe/contracts";
import { buildPriceBook, EconomyError, priceItems } from "../src/index.js";
import {
  catalogHas,
  catalogHasWithUniques,
  config,
  configWithUniques,
  itemMap,
  RELEASE,
  resolveUnique,
  responseA,
  responseB,
  uniqueResponse,
} from "./fixtures.js";

const build = (responses = [responseA, responseB], map = itemMap) =>
  buildPriceBook({
    config,
    itemMap: map,
    catalogHas,
    dataReleaseId: RELEASE,
    league: "TestLeague",
    fetchedAt: "2026-11-25T00:00:00Z",
    responses,
  });

describe("buildPriceBook", () => {
  it("maps provider ids to catalog ids and assigns confidence from volume", () => {
    const book = build();
    expect(book.referenceCurrencyItemId).toBe("cur-ref");
    const byId = Object.fromEntries(book.quotes.map((q) => [q.item.id, q]));
    expect(byId["cur-a"]).toMatchObject({
      amount: 4,
      confidence: "high",
      providerItemId: "prov-a",
    });
    expect(byId["cur-b"]).toMatchObject({ amount: 0.5, confidence: "medium" });
    expect(book.quotes.some((q) => q.item.id === "cur-ref")).toBe(false);
  });

  it("lists unmapped, not-in-catalog and unusable lines instead of dropping them", () => {
    expect(build().unmappedProviderItemIds).toEqual(["prov-ghost", "prov-unique", "prov-unknown"]);
  });

  it("keeps the first of two lines for the same catalog item and lists the other", () => {
    const dup = { ...responseA, lines: [...responseA.lines, { id: "prov-a2", primaryValue: 9 }] };
    const map = {
      ...itemMap,
      items: { ...itemMap.items, "prov-a2": { kind: "baseItem" as const, id: "cur-a" } },
    };
    const book = build([dup], map);
    expect(book.quotes.filter((q) => q.item.id === "cur-a")).toHaveLength(1);
    expect(book.unmappedProviderItemIds).toContain("prov-a2");
  });

  it("fails when the reference currency has no catalog id", () => {
    const map = { ...itemMap, items: { ...itemMap.items } };
    delete map.items["prov-ref"];
    expect(() => build([responseA], map)).toThrowError(EconomyError);
    try {
      build([responseA], map);
    } catch (e) {
      expect((e as EconomyError).code).toBe("reference_currency_unmapped");
    }
  });

  it("fails when responses disagree on the reference currency", () => {
    const other = { ...responseB, core: { primary: "prov-a" } };
    expect(() => build([responseA, other])).toThrowError(/disagree/);
  });
});

describe("priceItems", () => {
  const book = build();
  const ref = book.referenceCurrencyItemId;

  it("a direct quote in the reference currency is a market number", () => {
    const { prices } = priceItems(book, [{ kind: "baseItem", id: "cur-a" as never }]);
    expect(prices[0]?.price).toMatchObject({
      status: "ok",
      value: { amount: 4, currencyItemId: ref },
      source: {
        kind: "market",
        provider: "test-provider",
        league: "TestLeague",
        confidence: "high",
      },
    });
  });

  it("converts into another priced currency as derived from both quotes", () => {
    const { prices, inCurrencyItemId } = priceItems(
      book,
      [{ kind: "baseItem", id: "cur-b" as never }],
      "cur-a" as never,
    );
    expect(inCurrencyItemId).toBe("cur-a");
    const price = prices[0]?.price;
    if (price?.status !== "ok") throw new Error("expected ok");
    expect(price.value.amount).toBeCloseTo(0.125, 10);
    expect(price.source.kind).toBe("derived");
    if (price.source.kind === "derived") {
      expect(
        price.source.inputs.map((i) => (i.kind === "market" ? i.confidence : "?")).sort(),
      ).toEqual(["high", "medium"]);
    }
  });

  it("the reference currency in itself is no market quote: uncalibrated, not a made-up source", () => {
    const { prices } = priceItems(book, [{ kind: "baseItem", id: ref }]);
    expect(prices[0]?.price.status).toBe("uncalibrated");
  });

  it("the reference currency in another currency is derived from that currency's quote", () => {
    const price = priceItems(book, [{ kind: "baseItem", id: ref }], "cur-a" as never).prices[0]
      ?.price;
    if (price?.status !== "ok") throw new Error("expected ok");
    expect(price.value.amount).toBeCloseTo(0.25, 10);
    expect(price.source.kind).toBe("derived");
  });

  it("every result parses against the contract's ItemPrice", () => {
    const { prices } = priceItems(book, [
      { kind: "baseItem", id: "cur-a" as never },
      { kind: "baseItem", id: "nothing" as never },
    ]);
    for (const p of prices) expect(ItemPrice.safeParse(p).success).toBe(true);
  });

  it("is uncalibrated, with the reason, for items or target currencies without a quote", () => {
    const missing = priceItems(book, [{ kind: "baseItem", id: "nothing" as never }]).prices[0]
      ?.price;
    expect(missing).toMatchObject({ status: "uncalibrated" });
    const noTarget = priceItems(
      book,
      [{ kind: "baseItem", id: "cur-a" as never }],
      "nothing" as never,
    ).prices[0]?.price;
    expect(noTarget).toMatchObject({ status: "uncalibrated" });
    if (noTarget?.status === "uncalibrated") expect(noTarget.reason).toContain("nothing");
  });

  it("returns one entry per requested item in request order, also for repeats", () => {
    const items = [
      { kind: "baseItem" as const, id: "cur-b" as never },
      { kind: "baseItem" as const, id: "cur-a" as never },
      { kind: "baseItem" as const, id: "cur-b" as never },
    ];
    expect(priceItems(book, items).prices.map((p) => p.item.id)).toEqual([
      "cur-b",
      "cur-a",
      "cur-b",
    ]);
  });
});

describe("unique prices", () => {
  const buildU = (over: Partial<Parameters<typeof buildPriceBook>[0]> = {}) =>
    buildPriceBook({
      config: configWithUniques,
      itemMap,
      catalogHas: catalogHasWithUniques,
      dataReleaseId: RELEASE,
      league: "TestLeague",
      fetchedAt: "2026-11-25T00:00:00Z",
      responses: [responseA, responseB],
      uniqueResponses: [uniqueResponse],
      resolveUnique,
      ...over,
    });

  it("prices uniques in the book's reference currency, with confidence from the listing count", () => {
    const book = buildU();
    const quotes = book.quotes.filter((q) => q.item.kind === "uniqueItem");
    expect(
      quotes.map((q) => [String(q.item.id), q.amount, q.confidence, q.providerItemId]),
    ).toEqual([
      ["uniq-1", 2, "high", "unique:100"],
      ["uniq-2", 0.25, "low", "unique:101"],
    ]);
  });

  it("leaves variants, corrupted copies, unknown, ambiguous and unusable lines unmapped", () => {
    const unmapped = buildU().unmappedProviderItemIds;
    expect(unmapped).toEqual(
      expect.arrayContaining([
        "unique:102",
        "unique:103",
        "unique:104",
        "unique:105",
        "unique:106",
      ]),
    );
  });

  it("keeps uniques unmapped when no resolver is given", () => {
    const book = buildU({ resolveUnique: undefined });
    expect(book.quotes.some((q) => q.item.kind === "uniqueItem")).toBe(false);
    expect(book.unmappedProviderItemIds).toContain("unique:100");
  });

  it("does not use a resolved id the catalog does not have", () => {
    const book = buildU({ catalogHas });
    expect(book.quotes.some((q) => q.item.kind === "uniqueItem")).toBe(false);
  });

  it("answers economy.price for a unique in the reference currency (market, not derived)", () => {
    const book = buildU();
    const [price] = priceItems(book, [
      PricedItemRef.parse({ kind: "uniqueItem", id: "uniq-1" }),
    ]).prices;
    expect(price?.price.status).toBe("ok");
    if (price?.price.status === "ok") expect(price.price.source.kind).toBe("market");
  });
});
