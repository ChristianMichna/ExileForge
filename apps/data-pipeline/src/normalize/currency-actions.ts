import type { DataRelease } from "@astrolabe/contracts/catalog";
import { z } from "zod";
import { readGameDataManifest, readGameDataTable } from "../gamedata/export.ts";
import type { Finding, NormalizeConfig } from "./catalog.ts";

type Cfg = NormalizeConfig["currencyActions"];
type Rule = Cfg["rules"][string]["effects"][number];
type Rarities = NonNullable<DataRelease["rarities"]>;

/** The game's markup in descriptions: "[ItemRarity|Magic]" shows "Magic", "[Corrupted]" shows "Corrupted". */
export function stripMarkup(text: string): string {
  return text
    .replace(/\[([^\]|]*)\|([^\]]*)\]/g, "$2")
    .replace(/\[([^\]]*)\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const baseRow = z.object({ _index: z.int().nonnegative(), Id: z.string(), Name: z.string() });
const currencyRow = z.object({
  BaseItemType: z.int().nonnegative(),
  Action: z.string().nullish(),
  Description: z.string().nullish(),
});
const tieredRow = z.object({
  BaseItemType: z.int().nonnegative(),
  Tier: z.int().nonnegative().nullish(),
  LowerTierBaseItemType: z.int().nonnegative().nullish(),
  MinimumModLevel: z.int().nonnegative().nullish(),
});

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
 * Crafting actions of the currencies whose effect the game's own description
 * states, and the rules of the essences. A currency row is turned into an
 * action only when (1) the config has a rule for its `Action`, (2) the
 * description with markup removed matches the rule's `description` pattern
 * (a changed text leaves the action out and says so) and (3) every id the rule
 * uses exists in the release. A higher tier (TieredCurrency tier above 1 or
 * with a lower tier) is an action of its own whose `add-random-mod` effects get
 * the table's MinimumModLevel as `minModLevel` (assumption: that column is the
 * minimum level of the added mods); without a positive value it is left out.
 * Essences keep their existing action and gain the preconditions and leading
 * effects of the first essence rule whose description matches theirs; the
 * rule's `limitsByRarity` is set on their own mod, so its affix limits come from the release. Nothing is guessed.
 */
export async function currencyActions(opts: {
  gameDataDir: string;
  config: Cfg;
  rarities: Rarities | undefined;
  baseItemIds: ReadonlySet<string>;
  modGenerationTypes: ReadonlySet<string>;
  modDomains: ReadonlySet<string>;
  essenceActions: readonly Record<string, unknown>[];
}): Promise<{
  actions: Record<string, unknown>[];
  essenceActions: Record<string, unknown>[];
  findings: Finding[];
  summary: { currencyActions: number; higherTierActions: number; essencesWithRule: number };
}> {
  const { config, rarities } = opts;
  const findings: Finding[] = [];
  const summary = { currencyActions: 0, higherTierActions: 0, essencesWithRule: 0 };
  if (!rarities) {
    findings.push({
      kind: "currencyAction",
      id: "all",
      message:
        "the release has no rarities; currency rules and the essence rarity rule are left out",
    });
    return { actions: [], essenceActions: [...opts.essenceActions], findings, summary };
  }
  const rarityIds = new Set(rarities.rarities.map((r) => r.id));

  const checkRules = (what: string, rules: readonly Rule[]): string | undefined => {
    for (const r of rules) {
      const p = r.params as Record<string, unknown>;
      const rs = [
        ...(Array.isArray(p.rarities) ? p.rarities : []),
        ...(typeof p.rarity === "string" ? [p.rarity] : []),
      ];
      for (const id of rs)
        if (!rarityIds.has(String(id))) return `${what}: unknown rarity "${String(id)}"`;
      for (const g of Array.isArray(p.generationTypes) ? p.generationTypes : [])
        if (!opts.modGenerationTypes.has(String(g)))
          return `${what}: unknown generation type "${String(g)}"`;
      if (typeof p.domain === "string" && !opts.modDomains.has(p.domain))
        return `${what}: unknown mod domain "${p.domain}"`;
    }
    return undefined;
  };
  const build = (rules: readonly Rule[]) =>
    rules.map((r) => ({ op: r.op, params: { ...(r.params as Record<string, unknown>) } }));

  const manifest = await readGameDataManifest(opts.gameDataDir);
  const table = (name: string) => readGameDataTable(opts.gameDataDir, manifest, name);
  const bases = new Map(
    parseRows("BaseItemTypes", await table("BaseItemTypes"), baseRow).map((r) => [r._index, r]),
  );
  const currency = parseRows("CurrencyItems", await table("CurrencyItems"), currencyRow);
  // a currency that points to a lower tier, or has a tier above the first, is a higher tier;
  // its minimum mod level becomes the `minModLevel` of the mods it adds
  const higherTier = new Map<number, number | undefined>();
  const tierDuplicates = new Set<number>();
  for (const r of parseRows("TieredCurrency", await table("TieredCurrency"), tieredRow)) {
    if (!((r.Tier ?? 0) > 1 || r.LowerTierBaseItemType != null)) continue;
    if (higherTier.has(r.BaseItemType)) tierDuplicates.add(r.BaseItemType);
    // 0 is no filter at all, so it cannot make a tier differ from the base currency
    higherTier.set(r.BaseItemType, r.MinimumModLevel ? r.MinimumModLevel : undefined);
  }
  for (const idx of tierDuplicates) higherTier.set(idx, undefined);
  if (tierDuplicates.size > 0)
    findings.push({
      kind: "currencyAction",
      id: "tier-duplicates",
      message: `${String(tierDuplicates.size)} currencies have several TieredCurrency rows; they are left out`,
    });
  const rowByBaseId = new Map<string, z.infer<typeof currencyRow>>();
  for (const row of currency) {
    const id = bases.get(row.BaseItemType)?.Id;
    if (id !== undefined && id !== "") rowByBaseId.set(id, row);
  }

  // rules are checked once; a broken rule is a finding and its currencies stay out
  const usable = new Map<string, { pattern: RegExp; rule: Cfg["rules"][string] }>();
  for (const [action, rule] of Object.entries(config.rules)) {
    const problem = checkRules(`rule for ${action}`, [...rule.preconditions, ...rule.effects]);
    if (problem) findings.push({ kind: "currencyAction", id: action, message: problem });
    else usable.set(action, { pattern: new RegExp(rule.description), rule });
  }

  const actions: Record<string, unknown>[] = [];
  const skipped = {
    noDescriptionMatch: new Set<string>(),
    higherTier: new Set<string>(),
    notInCatalog: new Set<string>(),
  };
  const withoutRule = new Set<string>();
  const seenKeys = new Set<string>();
  for (const row of currency) {
    const base = bases.get(row.BaseItemType);
    const spec = row.Action ? usable.get(row.Action) : undefined;
    if (row.Action && !config.rules[row.Action]) withoutRule.add(row.Action);
    else if (row.Action && !seenKeys.has(row.Action)) seenKeys.add(row.Action);
    if (!base || !base.Id || !spec) continue;
    const id = base.Id;
    if (!opts.baseItemIds.has(id)) {
      skipped.notInCatalog.add(id);
      continue;
    }
    const tier = higherTier.has(row.BaseItemType);
    const minModLevel = higherTier.get(row.BaseItemType);
    if (tier && minModLevel === undefined) {
      skipped.higherTier.add(id);
      continue;
    }
    if (!spec.pattern.test(stripMarkup(row.Description ?? ""))) {
      skipped.noDescriptionMatch.add(id);
      continue;
    }
    actions.push({
      id,
      name: base.Name,
      kind: config.kind,
      itemId: id,
      preconditions: build(spec.rule.preconditions),
      effects: build(spec.rule.effects).map((e) =>
        tier && e.op === "add-random-mod" ? { ...e, params: { ...e.params, minModLevel } } : e,
      ),
    });
    summary.currencyActions++;
    if (tier) summary.higherTierActions++;
  }
  for (const [id, what, ids] of [
    [
      "higher-tier",
      "is a higher tier without a minimum mod level in TieredCurrency",
      skipped.higherTier,
    ],
    ["description", "has a description that does not match the rule", skipped.noDescriptionMatch],
    ["not-in-catalog", "is not a base item of the catalog", skipped.notInCatalog],
  ] as const)
    if (ids.size > 0)
      findings.push({
        kind: "currencyAction",
        id,
        message: `${String(ids.size)} currency items left out, each ${what}: ${[...ids].slice(0, 5).join(", ")}`,
      });
  for (const key of usable.keys())
    if (!seenKeys.has(key))
      findings.push({
        kind: "currencyAction",
        id: key,
        message:
          "no CurrencyItems row has this Action; the rule was not used (renamed in the game data?)",
      });
  if (withoutRule.size > 0)
    findings.push({
      kind: "currencyAction",
      id: "no-rule",
      message: `${String(withoutRule.size)} currency actions have no rule and give no crafting action: ${[...withoutRule].sort().join(", ")}`,
    });

  const variants = config.essence.map((v, i) => ({
    pattern: new RegExp(v.description),
    rule: v,
    problem: checkRules(`essence rule ${String(i)}`, [...v.preconditions, ...v.effects]),
  }));
  for (const v of variants)
    if (v.problem) findings.push({ kind: "currencyAction", id: "essence", message: v.problem });
  const essenceActions = opts.essenceActions.map((action) => {
    const row = rowByBaseId.get(String(action.id));
    const text = stripMarkup(row?.Description ?? "");
    const v = variants.find((x) => !x.problem && x.pattern.test(text));
    if (!v) return action;
    summary.essencesWithRule++;
    const own = (action.effects as { op: string; params: Record<string, unknown> }[]).map((e) =>
      v.rule.limitsByRarity && e.op === "add-specific-mod"
        ? { ...e, params: { ...e.params, limitsByRarity: true } }
        : e,
    );
    return {
      ...action,
      preconditions: [...(action.preconditions as unknown[]), ...build(v.rule.preconditions)],
      effects: [...build(v.rule.effects), ...own],
    };
  });
  const missing = opts.essenceActions.length - summary.essencesWithRule;
  if (missing > 0)
    findings.push({
      kind: "currencyAction",
      id: "essence",
      message: `${String(missing)} essences keep no rule: their description matches none of the ${String(variants.filter((v) => !v.problem).length)} usable essence rules`,
    });
  return { actions, essenceActions, findings, summary };
}
