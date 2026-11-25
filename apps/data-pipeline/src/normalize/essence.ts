import type { CraftingAction } from "@astrolabe/contracts/catalog";
import { z } from "zod";
import type { Json } from "../json.ts";
import type { Finding, NormalizeConfig } from "./catalog.ts";

const essenceRow = z.object({
  name: z.string().min(1),
  // Lua cannot tell an empty table from an empty list; both mean "no mods"
  mods: z.union([z.record(z.string().min(1), z.string().min(1)), z.array(z.never())]),
});

/**
 * Crafting actions for the essences PoB lists. PoB's key is the item's
 * metadata path, i.e. the id of the currency base item from the game data; its
 * `mods` map item class → mod id. Entries are kept only where the base item,
 * the item class and the mod exist in this release; every other entry is
 * dropped with a finding naming it, and an essence without any usable entry
 * produces no action (never an action with an empty or guessed effect).
 * Rarity rules are not added: PoB's essence data has none (stay unset rather
 * than guessed).
 */
export function essenceActions(
  rawEssences: Record<string, Json>,
  known: {
    baseItemIds: ReadonlySet<string>;
    itemClasses: ReadonlySet<string>;
    modIds: ReadonlySet<string>;
  },
  cfg: NormalizeConfig["essence"],
): { actions: CraftingAction[]; findings: Finding[] } {
  const findings: Finding[] = [];
  const actions: CraftingAction[] = [];
  for (const [id, raw] of Object.entries(rawEssences).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const row = essenceRow.safeParse(raw);
    if (!row.success) throw new Error(`essence ${id} is malformed`, { cause: row.error });
    if (!known.baseItemIds.has(id)) {
      findings.push({
        kind: "essence",
        id,
        message: `${row.data.name}: no currency base item with this id in the game data; left out`,
      });
      continue;
    }
    const modByItemClass: Record<string, string> = {};
    for (const [cls, mod] of Object.entries(Array.isArray(row.data.mods) ? {} : row.data.mods)) {
      if (!known.itemClasses.has(cls)) {
        findings.push({
          kind: "essence",
          id,
          message: `${row.data.name}: item class "${cls}" is not in the catalog; entry left out`,
        });
      } else if (!known.modIds.has(mod)) {
        findings.push({
          kind: "essence",
          id,
          message: `${row.data.name}: mod "${mod}" for ${cls} is not in the catalog; entry left out`,
        });
      } else modByItemClass[cls] = mod;
    }
    if (Object.keys(modByItemClass).length === 0) {
      findings.push({
        kind: "essence",
        id,
        message: `${row.data.name}: no usable item class and mod; no crafting action`,
      });
      continue;
    }
    actions.push({
      id,
      name: row.data.name,
      kind: cfg.kind,
      itemId: id,
      preconditions: [],
      effects: [{ op: cfg.op, params: { modByItemClass } }],
    } as unknown as CraftingAction);
  }
  return { actions, findings };
}
