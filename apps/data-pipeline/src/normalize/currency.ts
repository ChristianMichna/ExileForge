import type { BaseItem } from "@astrolabe/contracts/catalog";
import { z } from "zod";
import { readGameDataManifest, readGameDataTable } from "../gamedata/export.ts";
import type { Finding, NormalizeConfig } from "./catalog.ts";

const nonNeg = z.int().nonnegative();
// foreign keys are row indexes of the referenced table; null/absent means "no reference"
const ref = z.int().nonnegative().nullish();

const baseRow = z.object({
  _index: nonNeg,
  // the table has unused rows with empty ids or names; only selected rows must be complete
  Id: z.string(),
  Name: z.string(),
  ItemClass: nonNeg,
  DropLevel: nonNeg.nullish(),
});
const classRow = z.object({ _index: nonNeg, Id: z.string() });
const currencyRow = z.object({
  BaseItemType: nonNeg,
  StackSize: nonNeg.nullish(),
  CurrencyUseType: nonNeg.nullish(),
  Action: z.string().min(1).nullish(),
});
const essenceRow = z.object({
  BaseItemType: nonNeg,
  Tier: nonNeg.nullish(),
  Perfect: z.boolean().nullish(),
});
const tieredRow = z.object({
  BaseItemType: nonNeg,
  Tier: nonNeg.nullish(),
  MinimumModLevel: nonNeg.nullish(),
  LowerTierBaseItemType: ref,
});
const omenRow = z.object({ BaseItemType: nonNeg });
const exchangeRow = z.object({ Item: nonNeg, Category: ref });
const categoryRow = z.object({ _index: nonNeg, Id: z.string() });

type CurrencyConfig = NormalizeConfig["currency"];

function parseRows<T extends z.ZodType>(table: string, rows: readonly unknown[], schema: T) {
  return rows.map((row, i) => {
    const parsed = schema.safeParse(row);
    if (!parsed.success)
      throw new Error(`game-data ${table} row ${String(i)}: ${z.prettifyError(parsed.error)}`, {
        cause: parsed.error,
      });
    return parsed.data as z.infer<T>;
  });
}

/**
 * Currency-like base items (currency, essences, omens …) from the game-data
 * tables. Which CurrencyItems rows count is decided by the item classes in the
 * config; rows of other classes (soul cores, map fragments, incubators …) are
 * left out and counted in the findings. Foreign keys are row indexes; a key
 * that points nowhere is an error, an optional key that is not set is simply
 * absent. Ids are BaseItemTypes.Id (the game's metadata path), unlike the
 * name-based ids PoB gives equipment bases.
 */
export async function currencyBaseItems(
  gameDataDir: string,
  cfg: CurrencyConfig,
  takenIds: ReadonlySet<string>,
): Promise<{ baseItems: BaseItem[]; findings: Finding[]; errors: Finding[] }> {
  const findings: Finding[] = [];
  const errors: Finding[] = [];
  const manifest = await readGameDataManifest(gameDataDir);
  const table = (name: string) => readGameDataTable(gameDataDir, manifest, name);
  const optional = (name: string) =>
    manifest.tables.some((t) => t.name === name) ? table(name) : Promise.resolve([]);

  const bases = new Map(
    parseRows("BaseItemTypes", await table("BaseItemTypes"), baseRow).map((r) => [r._index, r]),
  );
  const classes = new Map(
    parseRows("ItemClasses", await table("ItemClasses"), classRow).map((r) => [r._index, r.Id]),
  );
  const categories = new Map(
    parseRows(
      "CurrencyExchangeCategories",
      await table("CurrencyExchangeCategories"),
      categoryRow,
    ).map((r) => [r._index, r.Id]),
  );
  const currency = parseRows("CurrencyItems", await table("CurrencyItems"), currencyRow);
  const essences = parseRows("Essences", await table("Essences"), essenceRow);
  const tiered = parseRows("TieredCurrency", await table("TieredCurrency"), tieredRow);
  const exchange = parseRows("CurrencyExchange", await table("CurrencyExchange"), exchangeRow);
  // Omens: own table where the patch has one, else the achievement list
  const hasOmens = manifest.tables.some((t) => t.name === "Omens");
  if (!hasOmens)
    findings.push({
      kind: "currency",
      id: "Omens",
      message: "the patch has no Omens table; omens are taken from AchievementOmenTypes only",
    });
  const omenRows = parseRows("Omens", await optional("Omens"), omenRow);
  const achievementOmens = parseRows(
    "AchievementOmenTypes",
    await table("AchievementOmenTypes"),
    omenRow,
  );

  const include = new Set(cfg.itemClasses);
  const classOf = (idx: number): string | undefined => {
    const b = bases.get(idx);
    return b === undefined ? undefined : classes.get(b.ItemClass);
  };

  const selected = new Map<number, BaseItem>();
  const skippedByClass = new Map<string, number>();
  for (const row of currency) {
    const base = bases.get(row.BaseItemType);
    if (base === undefined) {
      errors.push({
        kind: "currency",
        id: String(row.BaseItemType),
        message: "CurrencyItems row points to a missing BaseItemTypes row",
      });
      continue;
    }
    if (base.Id === "" || base.Name === "") {
      errors.push({
        kind: "currency",
        id: String(base._index),
        message: "CurrencyItems row names a base item without id or name",
      });
      continue;
    }
    const cls = classes.get(base.ItemClass);
    if (cls === undefined) {
      errors.push({ kind: "currency", id: base.Id, message: "item class row is missing" });
      continue;
    }
    if (!include.has(cls)) {
      skippedByClass.set(cls, (skippedByClass.get(cls) ?? 0) + 1);
      continue;
    }
    if (selected.has(base._index) || takenIds.has(base.Id)) {
      errors.push({ kind: "currency", id: base.Id, message: "id is not unique in the catalog" });
      continue;
    }
    const properties: BaseItem["properties"] = {};
    if (row.StackSize != null) properties.stackSize = row.StackSize;
    if (row.CurrencyUseType != null) properties.useType = row.CurrencyUseType;
    selected.set(base._index, {
      id: base.Id,
      name: base.Name,
      itemClass: cls,
      tags: row.Action ? [`${cfg.tags.action}${row.Action}`] : [],
      requirements: {},
      implicitModIds: [],
      properties,
      ...(base.DropLevel != null ? { dropLevel: base.DropLevel } : {}),
    } as unknown as BaseItem);
  }
  for (const [cls, n] of [...skippedByClass].sort())
    findings.push({
      kind: "currency",
      id: cls,
      message: `${String(n)} CurrencyItems rows of item class ${cls} are not in config currency.itemClasses and are left out`,
    });

  const target = (idx: number, table: string): BaseItem | undefined => {
    const base = bases.get(idx);
    if (base === undefined) {
      errors.push({
        kind: "currency",
        id: String(idx),
        message: `${table} row points to a missing BaseItemTypes row`,
      });
      return undefined;
    }
    const item = selected.get(idx);
    if (item === undefined)
      findings.push({
        kind: "currency",
        id: base.Id,
        message: `${table} row names an item that is not a selected currency item (class ${classOf(idx) ?? "unknown"}); ignored`,
      });
    return item;
  };
  const withTag = (item: BaseItem, tag: string) => {
    if (!item.tags.includes(tag)) item.tags.push(tag);
  };

  for (const row of essences) {
    const item = target(row.BaseItemType, "Essences");
    if (!item) continue;
    withTag(item, cfg.tags.essence);
    if (row.Perfect === true) withTag(item, cfg.tags.perfect);
    if (row.Tier != null) item.properties.essenceTier = row.Tier;
  }
  for (const row of tiered) {
    const item = target(row.BaseItemType, "TieredCurrency");
    if (!item) continue;
    if (row.Tier != null) item.properties.currencyTier = row.Tier;
    if (row.MinimumModLevel != null) item.properties.minimumModLevel = row.MinimumModLevel;
    if (row.LowerTierBaseItemType != null) {
      const lower = bases.get(row.LowerTierBaseItemType);
      if (lower === undefined || !selected.has(lower._index))
        errors.push({
          kind: "currency",
          id: item.id,
          message: "lower tier points to an item that is not a selected currency item",
        });
      else withTag(item, `${cfg.tags.lowerTier}${lower.Id}`);
    }
  }
  for (const row of [...omenRows, ...achievementOmens]) {
    const item = target(row.BaseItemType, "Omens");
    if (item) withTag(item, cfg.tags.omen);
  }
  for (const row of exchange) {
    if (!bases.has(row.Item)) {
      errors.push({
        kind: "currency",
        id: String(row.Item),
        message: "CurrencyExchange row points to a missing BaseItemTypes row",
      });
      continue;
    }
    const item = selected.get(row.Item);
    if (item === undefined) continue; // the exchange also lists items outside the selected classes
    if (row.Category == null) continue;
    const category = categories.get(row.Category);
    if (category === undefined) {
      errors.push({
        kind: "currency",
        id: item.id,
        message: "CurrencyExchange row points to a missing category",
      });
      continue;
    }
    withTag(item, `${cfg.tags.exchangeCategory}${category}`);
  }

  const baseItems = [...selected.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  baseItems.forEach((b) => b.tags.sort());
  return { baseItems, findings, errors };
}
