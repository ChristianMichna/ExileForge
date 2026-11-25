import { describe, expect, it } from "vitest";
import { buildPriceBook, EconomyError, priceItems } from "../src/index.js";
import { catalogHas, config, itemMap, RELEASE, responseA, responseB } from "./fixtures.js";

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

  it("the reference currency in itself is an identity, not a market quote", () => {
    const { prices } = priceItems(book, [{ kind: "baseItem", id: ref }]);
    const price = prices[0]?.price;
    if (price?.status !== "ok") throw new Error("expected ok");
    expect(price.value.amount).toBe(1);
    expect(price.source).toMatchObject({ kind: "derived", formula: "economy.identity" });
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
