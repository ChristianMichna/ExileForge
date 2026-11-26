import type { DataRelease } from "@astrolabe/contracts/catalog";
import { z } from "zod";
import { readGameDataManifest, readGameDataTable } from "../gamedata/export.ts";
import type { Json } from "../json.ts";
import type { Finding, NormalizeConfig } from "./catalog.ts";

type ReleaseFacts = Pick<
  DataRelease,
  "maxCharacterLevel" | "passivePoints" | "itemSlots" | "classifications" | "gameIds" | "rarities"
>;

/** PoB's CamelCase name as a classification id ("EnergyShield" -> "energy_shield"). */
function classificationId(pobName: string): string {
  return pobName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/**
 * Damage types and defence layers as ids of this release. The names come from
 * PoB's code (config); each id must exist among the release's mod tags,
 * otherwise nothing is guessed: the field is left out and a finding says which
 * names have no match.
 */
export function classificationsFrom(
  config: NormalizeConfig["releaseFacts"]["classifications"],
  vocabulary: ReadonlySet<string>,
): { value?: NonNullable<DataRelease["classifications"]>; finding?: Finding } {
  const damageTypes = config.damageTypes.map(classificationId);
  const defenceLayers = config.defenceLayers.map(classificationId);
  const missing = [...damageTypes, ...defenceLayers].filter((id) => !vocabulary.has(id));
  if (missing.length > 0)
    return {
      finding: {
        kind: "release",
        id: "classifications",
        message: `no matching tag in the release for ${missing.join(", ")}; classifications are left out`,
      },
    };
  return { value: { damageTypes, defenceLayers, origin: "pob-code" } };
}

/**
 * Item rarities of the release (PoB's names, snake case as ids) with the
 * most affixes per generation type. PoB's code gives a total (Item.lua: magic
 * 2, rare 6) that is shared evenly between the listed generation types; a total
 * that does not divide evenly, or a generation type that no mod has, leaves
 * the fact out with a finding.
 */
export function raritiesFrom(
  config: NormalizeConfig["releaseFacts"]["rarities"],
  generationTypes: ReadonlySet<string>,
  itemClasses: ReadonlySet<string> = new Set(),
): { value?: NonNullable<DataRelease["rarities"]>; finding?: Finding } {
  const split = (total: number): Record<string, number> | undefined =>
    total % config.affixGenerationTypes.length === 0
      ? Object.fromEntries(
          config.affixGenerationTypes.map((g) => [g, total / config.affixGenerationTypes.length]),
        )
      : undefined;
  const fail = (message: string) => ({
    finding: {
      kind: "release" as const,
      id: "rarities",
      message: `${message}; rarities are left out`,
    },
  });
  const unknown = config.affixGenerationTypes.filter((g) => !generationTypes.has(g));
  if (unknown.length > 0)
    return {
      finding: {
        kind: "release",
        id: "rarities",
        message: `no mod has generation type ${unknown.join(", ")}; rarities are left out`,
      },
    };
  const rarities = [];
  for (const r of config.list) {
    if (r.affixLimit === undefined) {
      rarities.push({ id: classificationId(r.name), name: r.name });
      continue;
    }
    const maxAffixes = split(r.affixLimit);
    if (!maxAffixes)
      return fail(
        `${r.name}: ${String(r.affixLimit)} affixes do not split evenly over ${config.affixGenerationTypes.join(", ")}`,
      );
    const byClass: Record<string, Record<string, number>> = {};
    for (const [cls, total] of Object.entries(r.affixLimitByItemClass ?? {})) {
      if (!itemClasses.has(cls))
        return fail(`${r.name}: item class ${cls} has no base item in the catalog`);
      const limits = split(total);
      if (!limits)
        return fail(
          `${r.name}, ${cls}: ${String(total)} affixes do not split evenly over ${config.affixGenerationTypes.join(", ")}`,
        );
      byClass[cls] = limits;
    }
    rarities.push({
      id: classificationId(r.name),
      name: r.name,
      maxAffixes,
      ...(Object.keys(byClass).length > 0 ? { maxAffixesByItemClass: byClass } : {}),
    });
  }
  return { value: { rarities, origin: "pob-code" } };
}

const levelRow = z.object({ Level: z.int().positive() });
const questRow = z.object({
  /**
   * PoB (Build.lua) counts a reward of Type "Cruel" as an act of its own. Today's data has no
   * Type; if it appears, the counting rule would need to be mirrored, so it is an error here.
   */
  Type: z.never().optional(),
  Act: z.int().positive(),
  AreaLevel: z.int().positive(),
  questPoints: z.int().positive().optional(),
});

const slotRow = z.object({
  order: z.int().positive(),
  label: z.string().min(1),
  weaponSet: z.union([z.literal(1), z.literal(2)]).optional(),
  // Lua cannot tell an empty list from an empty table; the extractor writes `{}` for none
  itemClasses: z.union([
    z.array(z.string().min(1)),
    z
      .object({})
      .strict()
      .transform((): string[] => []),
  ]),
  partialBases: z.array(z.string().min(1)).optional(),
  dependsOnSlot: z.string().min(1).optional(),
  optional: z.boolean().optional(),
});

/**
 * Slots as PoB defines them, in PoB's order. Every class and base a slot names
 * must exist in the catalog and every slot it depends on must be listed
 * (errors); a catalog class that no slot accepts is a warning, since that may
 * be right (jewels live in tree sockets) or a gap in what PoB was asked.
 */
export function itemSlotsFrom(
  rawSlots: Record<string, Json>,
  known: { itemClasses: ReadonlySet<string>; baseClassOf: ReadonlyMap<string, string> },
): {
  slots: NonNullable<DataRelease["itemSlots"]>["slots"];
  errors: Finding[];
  warnings: Finding[];
} {
  const errors: Finding[] = [];
  const parsed = Object.entries(rawSlots).map(([id, raw]) => {
    const row = slotRow.safeParse(raw);
    if (!row.success) throw new Error(`item slot ${id} is malformed`, { cause: row.error });
    return { id, ...row.data };
  });
  parsed.sort((a, b) => a.order - b.order);
  const ids = new Set(parsed.map((s) => s.id));
  const covered = new Set<string>();
  const baseClass = (baseId: string): string | undefined => known.baseClassOf.get(baseId);
  for (const slot of parsed) {
    for (const c of slot.itemClasses) {
      covered.add(c);
      if (!known.itemClasses.has(c))
        errors.push({
          kind: "itemSlot",
          id: slot.id,
          message: `item class ${c} has no base item in the catalog`,
        });
    }
    for (const b of slot.partialBases ?? []) {
      const cls = baseClass(b);
      if (cls === undefined)
        errors.push({ kind: "itemSlot", id: slot.id, message: `base ${b} is not in the catalog` });
      else covered.add(cls);
    }
    if (slot.dependsOnSlot !== undefined && !ids.has(slot.dependsOnSlot))
      errors.push({
        kind: "itemSlot",
        id: slot.id,
        message: `depends on slot ${slot.dependsOnSlot}, which is not listed`,
      });
  }
  const warnings = [...known.itemClasses]
    .filter((c) => !covered.has(c))
    .sort()
    .map((c) => ({
      kind: "itemSlot",
      id: c,
      message: `no equipment slot accepts item class ${c}`,
    }));
  return { slots: parsed, errors, warnings };
}

/** Highest level of the `ExperienceLevels` table of the game data. */
export async function readMaxCharacterLevel(gameDataDir: string, table: string): Promise<number> {
  const manifest = await readGameDataManifest(gameDataDir);
  const rows = await readGameDataTable(gameDataDir, manifest, table);
  const levels = rows.map((r, i) => {
    const parsed = levelRow.safeParse(r);
    if (!parsed.success)
      throw new Error(`game-data table ${table} row ${String(i)} has no valid Level`, {
        cause: parsed.error,
      });
    return parsed.data.Level;
  });
  if (levels.length === 0) throw new Error(`game-data table ${table} is empty`);
  return Math.max(...levels);
}

/**
 * Weapon set points per act from PoB's quest rewards, the way PoB itself
 * counts them (Build.lua): only rewards with `questPoints` count, and the
 * area level of an act is the highest one among those rewards.
 */
export function weaponSetPointsByAct(
  questRewards: Record<string, Json>,
): { act: number; areaLevel: number; points: number }[] {
  const acts = new Map<number, { areaLevel: number; points: number }>();
  for (const [id, raw] of Object.entries(questRewards).sort(([a], [b]) => a.localeCompare(b))) {
    const parsed = questRow.safeParse(raw);
    if (!parsed.success)
      throw new Error(`quest reward ${id} is malformed`, { cause: parsed.error });
    const q = parsed.data;
    if (q.questPoints === undefined) continue;
    const entry = acts.get(q.Act) ?? { areaLevel: 0, points: 0 };
    acts.set(q.Act, {
      areaLevel: Math.max(entry.areaLevel, q.AreaLevel),
      points: entry.points + q.questPoints,
    });
  }
  return [...acts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([act, v]) => ({ act, areaLevel: v.areaLevel, points: v.points }));
}

/**
 * The release-level facts for the server's S5. A fact that cannot be read is
 * left out and reported as a finding; it is never replaced by a default.
 */
export async function buildReleaseFacts(opts: {
  config: NormalizeConfig["releaseFacts"];
  questRewards: Record<string, Json>;
  itemSlots: Record<string, Json>;
  known: { itemClasses: ReadonlySet<string>; baseClassOf: ReadonlyMap<string, string> };
  /** Classification ids of the release (mod tags). */
  vocabulary: ReadonlySet<string>;
  /** Generation types of the release's mods. */
  generationTypes: ReadonlySet<string>;
  gameDataDir?: string;
}): Promise<{ facts: ReleaseFacts; findings: Finding[]; errors: Finding[] }> {
  const { config } = opts;
  const facts: ReleaseFacts = {};
  const findings: Finding[] = [];

  const { slots, errors, warnings } = itemSlotsFrom(opts.itemSlots, opts.known);
  findings.push(...warnings);
  facts.itemSlots = { slots, origin: "pob-code" };

  const rarities = raritiesFrom(config.rarities, opts.generationTypes, opts.known.itemClasses);
  if (rarities.value) facts.rarities = rarities.value;
  if (rarities.finding) findings.push(rarities.finding);

  const classifications = classificationsFrom(config.classifications, opts.vocabulary);
  if (classifications.value) facts.classifications = classifications.value;
  if (classifications.finding) findings.push(classifications.finding);

  if (opts.gameDataDir === undefined) {
    findings.push({
      kind: "release",
      id: "maxCharacterLevel",
      message: "no game data given, maxCharacterLevel is left out",
    });
  } else {
    facts.maxCharacterLevel = {
      value: await readMaxCharacterLevel(opts.gameDataDir, config.maxLevelTable),
      origin: "game-data",
    };
  }

  const acts = weaponSetPointsByAct(opts.questRewards);
  if (acts.length === 0) {
    findings.push({
      kind: "release",
      id: "passivePoints",
      message: "PoB lists no quest reward with passive points, passivePoints is left out",
    });
  } else {
    facts.passivePoints = {
      mainTree: { ...config.mainTree, origin: "pob-code" },
      weaponSetByAct: { acts, origin: "pob-data" },
    };
  }
  return { facts, findings, errors };
}
