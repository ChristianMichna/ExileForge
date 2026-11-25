import type { ItemTextRenderer } from "@exileforge/calc-client";
import type { BaseItem, Mod, UniqueItem } from "@exileforge/contracts/catalog";
import type { CatalogPort } from "../ports/catalog.js";

/*
 * PoB's item text format (Classes/Item.lua, ParseRaw): "Rarity: X", name, base
 * name, optional "Item Level:", "Implicits: N", then the mod lines. PoB finds
 * the base by name and recognises mod lines by their text. The words below
 * are PoB's own rarity keys (Data/Global.lua colorCodes), not game data.
 */
const POB_RARITIES = ["NORMAL", "MAGIC", "RARE", "UNIQUE"] as const;
const RANGE = /\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g;

/** Error with the slot and the missing piece of data, so a failed calculation says what to fix. */
export class ItemRenderError extends Error {
  override readonly name = "ItemRenderError";
}

/**
 * Renders ItemSpecs as PoB item text from catalog data only. Anything the
 * renderer cannot express (unchosen unique variant, socketables, unknown
 * rarity) throws instead of producing an item that differs from the spec.
 */
export function createItemRenderer(catalog: CatalogPort): ItemTextRenderer {
  const entity = <T>(kind: "uniqueItem" | "baseItem" | "mod", id: string, what: string): T => {
    const found = catalog.get({ kind, id });
    if (found === undefined) {
      throw new ItemRenderError(`${what} ${id} is not in data release ${catalog.dataReleaseId}`);
    }
    return found.entity as T;
  };
  const modText = (id: string): string[] => {
    const mod = entity<Mod>("mod", id, "Mod");
    if (mod.text === undefined || mod.text === "") {
      throw new ItemRenderError(`Mod ${id} has no text in data release ${catalog.dataReleaseId}`);
    }
    return mod.text.split("\n");
  };

  return (item, slot) => {
    try {
      if (item.kind === "unique") {
        const unique = entity<UniqueItem>("uniqueItem", item.uniqueId, "Unique item");
        const base = entity<BaseItem>("baseItem", unique.baseItemId, "Base item");
        const variants = unique.variants.map((v) => v.id);
        if (item.variantId !== undefined && !variants.includes(item.variantId)) {
          throw new ItemRenderError(`Unique ${unique.id} has no variant ${item.variantId}`);
        }
        if (variants.length > 0 && item.variantId === undefined) {
          throw new ItemRenderError(`Unique ${unique.id} has variants; the spec must pick one`);
        }
        const lines = unique.mods
          .filter((m) => m.variantIds === undefined || m.variantIds.includes(item.variantId ?? ""))
          .flatMap((m) => (m.text ?? "").split("\n"))
          .filter((l) => l !== "");
        return ["Rarity: UNIQUE", unique.name, base.name, "Implicits: 0", ...lines].join("\n");
      }

      const rarity = item.rarity.toUpperCase();
      if (!(POB_RARITIES as readonly string[]).includes(rarity)) {
        throw new ItemRenderError(`Rarity ${item.rarity} is not one of PoB's rarities`);
      }
      if (item.socketables.length > 0) {
        throw new ItemRenderError("Socketables are not supported by the item renderer yet");
      }
      const base = entity<BaseItem>("baseItem", item.baseItemId, "Base item");
      const implicits = base.implicitModIds.flatMap((id) => modText(id));
      const explicits = item.mods.flatMap((m) =>
        modText(m.modId).map((line) => roll(line, m.rollFraction)),
      );
      return [
        `Rarity: ${rarity}`,
        ...(rarity === "NORMAL" || rarity === "MAGIC"
          ? [base.name]
          : [`${base.name} (ExileForge)`, base.name]),
        ...(item.itemLevel === undefined ? [] : [`Item Level: ${item.itemLevel}`]),
        `Implicits: ${implicits.length}`,
        ...implicits.map((line) => roll(line, 0.5)),
        ...explicits,
      ].join("\n");
    } catch (error) {
      throw new ItemRenderError(
        `Cannot render the item in slot ${slot}: ${(error as Error).message}`,
        {
          cause: error,
        },
      );
    }
  };
}

/** Replaces each "(min-max)" by the value at `fraction` of the range, keeping the range's decimals. */
function roll(line: string, fraction: number): string {
  return line.replace(RANGE, (_all, lo: string, hi: string) => {
    const decimals = Math.max(decimalsOf(lo), decimalsOf(hi));
    const value = Number(lo) + (Number(hi) - Number(lo)) * fraction;
    return value.toFixed(decimals);
  });
}

function decimalsOf(text: string): number {
  return text.split(".")[1]?.length ?? 0;
}
