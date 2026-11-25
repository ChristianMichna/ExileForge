import { describe, expect, it } from "vitest";
import { currencyBaseItems } from "../src/normalize/currency.ts";
import { cfg } from "./fixtures/raw-catalog.ts";
import { tables, write } from "./fixtures/game-data.ts";

// the fixture exchange lists a soul core (a class outside itemClasses) too
const off = { ...cfg.currency, includeExchangeItems: false };
const on = { ...cfg.currency, includeExchangeItems: true };

describe("currencyBaseItems", () => {
  it("builds base items with tags and properties and reports what it left out", async () => {
    const dir = await write(tables());
    const { baseItems, findings, errors } = await currencyBaseItems(dir, off, new Set());
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
    const { errors } = await currencyBaseItems(dir, off, new Set(["Test/Omen"]));
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
    const { errors } = await currencyBaseItems(dir, off, new Set());
    const text = errors.map((e) => `${e.id}: ${e.message}`).join("\n");
    expect(text).toMatch(/99: Essences row points to a missing BaseItemTypes row/);
    expect(text).toMatch(/98: CurrencyExchange row points to a missing BaseItemTypes row/);
    expect(text).toMatch(/97: CurrencyItems row points to a missing BaseItemTypes row/);
  });

  it("leaves out placeholder rows without id or name and says so", async () => {
    const t = tables();
    t.BaseItemTypes = [
      ...(t.BaseItemTypes ?? []),
      { Id: "", Name: "", ItemClass: 0, DropLevel: 0 },
    ];
    const ok = await currencyBaseItems(await write(t), off, new Set());
    expect(ok.errors).toEqual([]);
    t.CurrencyItems = [...(t.CurrencyItems ?? []), { BaseItemType: 5, StackSize: 1 }];
    const res = await currencyBaseItems(await write(t), off, new Set());
    expect(res.errors).toEqual([]);
    expect(res.baseItems).toHaveLength(4);
    expect(res.findings.map((f) => f.message).join()).toMatch(
      /1 CurrencyItems rows name a base item without id or name/,
    );
  });

  it("treats an empty action as none", async () => {
    const t = tables();
    t.CurrencyItems = (t.CurrencyItems ?? []).map((r) => ({ ...r, Action: "" }));
    const { baseItems, errors } = await currencyBaseItems(await write(t), off, new Set());
    expect(errors).toEqual([]);
    expect(baseItems.find((b) => b.id === "Test/Orb")?.tags).toEqual([
      "exchange_category:Currency",
    ]);
  });

  it("notes that the patch has no Omens table", async () => {
    const dir = await write(tables());
    const { findings } = await currencyBaseItems(dir, off, new Set());
    expect(findings.map((f) => f.message).join("\n")).toMatch(/no Omens table/);
  });

  it("takes every item of the game's exchange list whatever its class", async () => {
    const { baseItems, findings, errors } = await currencyBaseItems(
      await write(tables()),
      on,
      new Set(),
    );
    expect(errors).toEqual([]);
    const core = baseItems.find((b) => b.id === "Test/Core");
    expect(core).toMatchObject({
      itemClass: "SoulCore",
      tags: ["exchange_category:Currency"],
      properties: {},
    });
    expect(findings.map((f) => f.message).join()).not.toMatch(/SoulCore/);
  });
});
