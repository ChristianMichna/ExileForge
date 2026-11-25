import { describe, expect, it } from "vitest";
import { currencyBaseItems } from "../src/normalize/currency.ts";
import { cfg } from "./fixtures/raw-catalog.ts";
import { tables, write } from "./fixtures/game-data.ts";

describe("currencyBaseItems", () => {
  it("builds base items with tags and properties and reports what it left out", async () => {
    const dir = await write(tables());
    const { baseItems, findings, errors } = await currencyBaseItems(dir, cfg.currency, new Set());
    expect(errors).toEqual([]);
    expect(baseItems.map((b) => b.id)).toEqual([
      "Test/Essence",
      "Test/Omen",
      "Test/Orb",
      "Test/Orb2",
    ]);
    const byId = Object.fromEntries(baseItems.map((b) => [b.id, b]));
    expect(byId["Test/Orb"]).toMatchObject({
      name: "Test Orb",
      itemClass: "StackableCurrency",
      dropLevel: 3,
      properties: { stackSize: 10, useType: 2 },
      tags: ["currency_action:test_action", "exchange_category:Currency"],
    });
    expect(byId["Test/Orb2"]).toMatchObject({
      properties: { currencyTier: 2, minimumModLevel: 35 },
      tags: ["lower_tier:Test/Orb"],
    });
    expect(byId["Test/Essence"]?.tags).toEqual(["essence", "perfect"]);
    expect(byId["Test/Essence"]?.properties).toMatchObject({ essenceTier: 1 });
    expect(byId["Test/Omen"]?.tags).toEqual(["omen"]);
    expect(findings.map((f) => f.message).join("\n")).toMatch(
      /1 CurrencyItems rows of item class SoulCore/,
    );
  });

  it("is an error when a key points nowhere or an id is taken", async () => {
    const bad = tables();
    bad.TieredCurrency = [
      { BaseItemType: 1, Tier: 2, MinimumModLevel: 35, LowerTierBaseItemType: 4 },
    ];
    bad.CurrencyExchange = [{ Item: 0, Category: 9 }];
    const dir = await write(bad);
    const { errors } = await currencyBaseItems(dir, cfg.currency, new Set(["Test/Omen"]));
    const text = errors.map((e) => `${e.id}: ${e.message}`).join("\n");
    expect(text).toMatch(/Test\/Orb2: lower tier points to an item that is not/);
    expect(text).toMatch(/Test\/Orb: CurrencyExchange row points to a missing category/);
    expect(text).toMatch(/Test\/Omen: id is not unique/);
  });

  it("is an error when a table row points to a missing base item", async () => {
    const bad = tables();
    bad.Essences = [{ BaseItemType: 99, Tier: 1, Perfect: false }];
    bad.CurrencyExchange = [{ Item: 98, Category: 0 }];
    bad.CurrencyItems = [...(bad.CurrencyItems ?? []), { BaseItemType: 97, StackSize: 1 }];
    const dir = await write(bad);
    const { errors } = await currencyBaseItems(dir, cfg.currency, new Set());
    const text = errors.map((e) => `${e.id}: ${e.message}`).join("\n");
    expect(text).toMatch(/99: Essences row points to a missing BaseItemTypes row/);
    expect(text).toMatch(/98: CurrencyExchange row points to a missing BaseItemTypes row/);
    expect(text).toMatch(/97: CurrencyItems row points to a missing BaseItemTypes row/);
  });

  it("notes that the patch has no Omens table", async () => {
    const dir = await write(tables());
    const { findings } = await currencyBaseItems(dir, cfg.currency, new Set());
    expect(findings.map((f) => f.message).join("\n")).toMatch(/no Omens table/);
  });
});
