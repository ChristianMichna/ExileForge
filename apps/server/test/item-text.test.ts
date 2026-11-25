import { describe, expect, it } from "vitest";
import { ItemSpec } from "@exileforge/contracts/build";
import { CatalogShard } from "@exileforge/contracts/catalog";
import { MemoryCatalog } from "../src/catalog/memory-catalog.js";
import { createItemRenderer } from "../src/calc/item-text.js";
import { RELEASE } from "./fixtures.js";

/* Invented ids and names only (no game data); the real format was checked against PoB. */
const shard = (kind: string, entities: unknown[]) =>
  CatalogShard.parse({ schemaVersion: 1, dataReleaseId: RELEASE, kind, entities });

const mod = (id: string, text: string | undefined) => ({
  id,
  groups: ["FixGroup"],
  generationType: "Prefix",
  domains: ["Item"],
  requiredLevel: 1,
  stats: [],
  spawnWeights: [],
  ...(text === undefined ? {} : { text }),
});

const catalog = new MemoryCatalog(RELEASE, [
  shard("baseItem", [
    {
      id: "FixBase",
      name: "Fixture Base",
      itemClass: "FixClass",
      tags: [],
      requirements: {},
      implicitModIds: ["FixImplicit"],
      properties: {},
    },
  ]),
  shard("mod", [
    mod("FixImplicit", "+(10-20) to Fixture Stat"),
    mod("FixPrefix", "(10-20)% increased Fixture Thing\nAdds (1.0-2.0) Fixture Damage"),
    mod("FixNoText", undefined),
  ]),
  shard("uniqueItem", [
    {
      id: "FixUnique",
      name: "Fixture Unique",
      baseItemId: "FixBase",
      mods: [
        { stats: [], text: "always line" },
        { stats: [], text: "only variant one", variantIds: ["v1"] },
        { stats: [], text: "only variant two", variantIds: ["v2"] },
      ],
      variants: [
        { id: "v1", name: "One" },
        { id: "v2", name: "Two" },
      ],
    },
  ]),
]);
const render = createItemRenderer(catalog);

describe("createItemRenderer", () => {
  it("renders a unique with the lines of the chosen variant", () => {
    expect(
      render(ItemSpec.parse({ kind: "unique", uniqueId: "FixUnique", variantId: "v2" }), "Ring 1"),
    ).toBe(
      [
        "Rarity: UNIQUE",
        "Fixture Unique",
        "Fixture Base",
        "Implicits: 0",
        "always line",
        "only variant two",
      ].join("\n"),
    );
  });

  it("refuses a unique with variants when none is chosen, or an unknown one", () => {
    expect(() =>
      render(ItemSpec.parse({ kind: "unique", uniqueId: "FixUnique" }), "Ring 1"),
    ).toThrow(/pick one/);
    expect(() =>
      render(ItemSpec.parse({ kind: "unique", uniqueId: "FixUnique", variantId: "x" }), "Ring 1"),
    ).toThrow(/no variant x/);
  });

  it("renders a crafted item with base implicits and mods with PoB-side rolls", () => {
    const text = render(
      ItemSpec.parse({
        kind: "crafted",
        baseItemId: "FixBase",
        rarity: "Rare",
        itemLevel: 80,
        mods: [{ modId: "FixPrefix", rollFraction: 0.5, required: true }],
        socketables: [],
      }),
      "Ring 1",
    );
    expect(text.split("\n")).toEqual([
      "Rarity: RARE",
      "Fixture Base (ExileForge)",
      "Fixture Base",
      "Item Level: 80",
      "Implicits: 1",
      "+(10-20) to Fixture Stat",
      "{range:0.5}(10-20)% increased Fixture Thing",
      "{range:0.5}Adds (1.0-2.0) Fixture Damage",
    ]);
  });

  it("names the slot and the cause for data it cannot render", () => {
    const crafted = (extra: object) =>
      ItemSpec.parse({
        kind: "crafted",
        baseItemId: "FixBase",
        rarity: "RARE",
        mods: [],
        socketables: [],
        ...extra,
      });
    expect(() => render(crafted({ rarity: "Shiny" }), "Ring 1")).toThrow(/slot Ring 1.*rarity/i);
    expect(() =>
      render(
        crafted({ mods: [{ modId: "FixNoText", rollFraction: 0.5, required: true }] }),
        "Ring 1",
      ),
    ).toThrow(/no text/);
    expect(() =>
      render(crafted({ socketables: [{ kind: "baseItem", id: "FixBase" }] }), "Ring 1"),
    ).toThrow(/Socketables/);
    expect(() => render(crafted({ baseItemId: "Nope" }), "Ring 1")).toThrow(/Nope/);
  });

  it("refuses unique lines it would have to drop silently", () => {
    const broken = new MemoryCatalog(RELEASE, [
      shard("baseItem", [
        {
          id: "B",
          name: "Base",
          itemClass: "C",
          tags: [],
          requirements: {},
          implicitModIds: [],
          properties: {},
        },
      ]),
      shard("uniqueItem", [
        { id: "NoText", name: "N", baseItemId: "B", mods: [{ stats: [] }], variants: [] },
        {
          id: "StrayVariant",
          name: "S",
          baseItemId: "B",
          mods: [{ stats: [], text: "x", variantIds: ["v1"] }],
          variants: [],
        },
      ]),
    ]);
    const r = createItemRenderer(broken);
    expect(() => r(ItemSpec.parse({ kind: "unique", uniqueId: "NoText" }), "Ring 1")).toThrow(
      /no text/,
    );
    expect(() => r(ItemSpec.parse({ kind: "unique", uniqueId: "StrayVariant" }), "Ring 1")).toThrow(
      /names variants/,
    );
  });

  it("renders NORMAL and MAGIC items with the base name only", () => {
    const text = (rarity: string) =>
      render(
        ItemSpec.parse({
          kind: "crafted",
          baseItemId: "FixBase",
          rarity,
          mods: [],
          socketables: [],
        }),
        "Ring 1",
      ).split("\n");
    expect(text("normal").slice(0, 2)).toEqual(["Rarity: NORMAL", "Fixture Base"]);
    expect(text("Magic").slice(0, 2)).toEqual(["Rarity: MAGIC", "Fixture Base"]);
  });
});
