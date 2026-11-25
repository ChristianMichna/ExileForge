import { describe, expect, it } from "vitest";
import { essenceActions } from "../src/normalize/essence.ts";
import { validateCatalog } from "../src/normalize/validate.ts";
import { cfg } from "./fixtures/raw-catalog.ts";

const known = {
  baseItemIds: new Set(["E1", "E2", "E3", "E4"]),
  itemClasses: new Set(["Ring"]),
  modIds: new Set(["ModA"]),
};

describe("essenceActions", () => {
  it("keeps usable entries and names every drop", () => {
    const { actions, findings } = essenceActions(
      {
        E1: { name: "One", mods: { Ring: "ModA", Wand: "ModA" } },
        E2: { name: "Two", mods: { Ring: "Missing" } }, // base exists, nothing usable
        E3: { name: "Three", mods: [] }, // empty Lua list
        E9: { name: "Nine", mods: { Ring: "ModA" } }, // no base
      },
      known,
      cfg.essence,
    );
    expect(actions.map((a) => a.id)).toEqual(["E1"]);
    expect(actions[0]?.["effects"]).toEqual([
      { op: cfg.essence.op, params: { modByItemClass: { Ring: "ModA" } } },
    ]);
    const text = findings.map((f) => `${f.id}: ${f.message}`).join("\n");
    expect(text).toMatch(/E1: One: item class "Wand"/);
    expect(text).toMatch(/E2: Two: no usable item class and mod/);
    expect(text).toMatch(/E3: Three: no usable item class and mod/);
    expect(text).toMatch(/E9: Nine: no currency base item/);
  });

  it("fails on a malformed row", () => {
    expect(() => essenceActions({ E1: { mods: {} } }, known, cfg.essence)).toThrow(/malformed/);
  });
});

describe("validateCatalog for crafting actions", () => {
  it("rejects unknown classes and mods in modByItemClass", () => {
    const empty = {
      baseItem: [],
      craftingAction: [],
      mod: [],
      uniqueItem: [],
      gem: [],
      passiveNode: [],
      passiveGroup: [],
      characterClass: [],
      ascendancy: [],
      statTranslation: [],
    };
    const { errors } = validateCatalog({
      ...empty,
      craftingAction: [
        {
          id: "E1",
          name: "One",
          kind: "essence",
          itemId: "E1",
          effects: [{ op: "x", params: { modByItemClass: { Ring: "NoMod" } } }],
        },
      ],
    });
    const text = errors.map((e) => e.message).join("\n");
    expect(text).toMatch(/unknown item class "Ring"/);
    expect(text).toMatch(/unknown mod "NoMod"/);
    expect(text).toMatch(/unknown baseItem "E1"/);
  });
});
