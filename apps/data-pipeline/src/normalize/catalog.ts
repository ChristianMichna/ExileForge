import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Json } from "../json.ts";
import { modLines, resolveModStats } from "./mod-stats.ts";
import type { MatchResult, StatMatcher } from "./stat-matcher.ts";

/*
 * Raw PoB snapshot -> catalog entities (shape of @exileforge/contracts/catalog).
 * Rules (Christian, 2026-11-24): ids only from PoB data. Bases and uniques use
 * PoB's names as ids, gems PoB's gameId, mods the game mod id, passive nodes
 * PoB's numeric skill id, ascendancies PoB's internalId.
 * Nothing is invented: optional values PoB does not have are left out, a
 * missing required value is an error, and every line whose stats cannot be
 * determined stays visible with its reason (in the entity where the contract
 * has room for it, otherwise in the findings). Whatever is dropped is counted
 * in the summary. Validation against the contract and referential integrity
 * run afterwards (validate.ts).
 */

export const normalizeConfigSchema = z
  .object({
    $comment: z.string().optional(),
    lang: z.string().min(2),
    statScopes: z.object({ mod: z.string().min(1), passiveNode: z.string().min(1) }).strict(),
    passiveNodeKinds: z
      .object({
        flags: z.array(z.tuple([z.string().min(1), z.string().min(1)])),
        default: z.string().min(1),
      })
      .strict(),
    modTiers: z
      .object({ $comment: z.string().optional(), generationTypes: z.array(z.string().min(1)) })
      .strict(),
    modGenerationTypeFallback: z.string().min(1),
    baseItemPropertyGroups: z.array(z.string().min(1)),
    classAttributePrefix: z.string().min(1),
  })
  .strict();
export type NormalizeConfig = z.infer<typeof normalizeConfigSchema>;

/** The parsed config and the SHA-256 of exactly the bytes it was parsed from. */
export async function loadNormalizeConfig(
  path: string,
): Promise<{ config: NormalizeConfig; sha256: string }> {
  let bytes: Buffer;
  let raw: unknown;
  try {
    bytes = await readFile(path);
    raw = JSON.parse(bytes.toString("utf8"));
  } catch (cause) {
    throw new Error(`cannot read normalize config ${path}`, { cause });
  }
  const parsed = normalizeConfigSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(`invalid normalize config ${path}: ${z.prettifyError(parsed.error)}`, {
      cause: parsed.error,
    });
  return { config: parsed.data, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export type UnresolvedReason = "unmatched" | "ambiguous" | "lossy" | "hidden";
export interface Unresolved {
  text: string;
  reason: UnresolvedReason;
}

/** Entities per contract kind, as plain JSON objects (validated in validate.ts). */
export type CatalogEntities = Record<
  | "baseItem"
  | "mod"
  | "uniqueItem"
  | "gem"
  | "passiveNode"
  | "passiveGroup"
  | "characterClass"
  | "ascendancy"
  | "statTranslation",
  Record<string, unknown>[]
>;

/** A problem found while normalising. */
export interface Finding {
  kind: string;
  id: string;
  message: string;
}

/** A line whose stats stay open and that the contract has no field for. */
export interface UnresolvedFinding extends Unresolved {
  kind: string;
  id: string;
}

/** Counts of everything that is not fully represented in the entities. */
export interface NormalizeSummary {
  /** lines with undetermined stats, per entity kind and reason */
  unresolved: Record<string, Record<UnresolvedReason, number>>;
  /** mods without generation type in PoB (written as the configured fallback) */
  modsWithoutGenerationType: number;
  /** mods with stats whose description renders no text (see `hiddenStatGroups`) */
  modsWithHiddenStatGroups: number;
  /** PoB per-level gem fields the contract has no place for, by field */
  gemLevelFieldsNotInContract: Record<string, number>;
  /** per-level gem stat values PoB interpolates at run time (not literal data) */
  gemInterpolatedStatValues: number;
  /** gem stat sets after the first (alternate modes), not mapped */
  gemAdditionalStatSets: number;
  statTranslations: {
    descriptions: number;
    withoutStats: number;
    withoutVariants: number;
    gemQualityVariantsSkipped: number;
    emptyVariantsSkipped: number;
  };
}

export interface NormalizeResult {
  entities: CatalogEntities;
  /** missing required source values: block the release */
  errors: Finding[];
  /** source data PoB does not give unambiguously; visible, non-blocking */
  warnings: Finding[];
  /** open lines of kinds whose contract has no `unresolved` field */
  unresolved: UnresolvedFinding[];
  /** mod id + trade hash of stat groups that render no text */
  hiddenStatGroups: { modId: string; tradeHash: string }[];
  summary: NormalizeSummary;
}

type Obj = Record<string, Json>;
type RawKinds = Readonly<Record<string, Readonly<Record<string, Json>>>>;

function obj(v: Json | undefined): Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
}
/** Lua writes empty tables as {}; list values come as arrays. */
function list(v: Json | undefined): Json[] {
  return Array.isArray(v) ? v : [];
}
function str(v: Json | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function num(v: Json | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function trueKeys(v: Json | undefined): string[] {
  return Object.entries(obj(v))
    .filter(([, x]) => x === true)
    .map(([k]) => k)
    .sort();
}
function kindOf(raw: RawKinds, kind: string): Readonly<Record<string, Json>> {
  const k = raw[kind];
  if (!k) throw new Error(`raw snapshot has no kind ${kind}`);
  return k;
}

class Context {
  readonly errors: Finding[] = [];
  readonly warnings: Finding[] = [];
  readonly unresolved: UnresolvedFinding[] = [];
  readonly hiddenStatGroups: { modId: string; tradeHash: string }[] = [];
  readonly summary: NormalizeSummary = {
    unresolved: {},
    modsWithoutGenerationType: 0,
    modsWithHiddenStatGroups: 0,
    gemLevelFieldsNotInContract: {},
    gemInterpolatedStatValues: 0,
    gemAdditionalStatSets: 0,
    statTranslations: {
      descriptions: 0,
      withoutStats: 0,
      withoutVariants: 0,
      gemQualityVariantsSkipped: 0,
      emptyVariantsSkipped: 0,
    },
  };

  warn(kind: string, id: string, message: string): void {
    this.warnings.push({ kind, id, message });
  }
  error(kind: string, id: string, message: string): void {
    this.errors.push({ kind, id, message });
  }
  /** A required value is missing: error finding; the placeholder never reaches a release. */
  requireStr(kind: string, id: string, field: string, v: Json | undefined): string {
    const s = str(v);
    if (s === undefined) this.error(kind, id, `source has no ${field}`);
    return s ?? "";
  }
  requireNum(kind: string, id: string, field: string, v: Json | undefined): number {
    const n = num(v);
    if (n === undefined) this.error(kind, id, `source has no ${field}`);
    return n ?? -1;
  }
  countUnresolved(kind: string, reason: UnresolvedReason): void {
    const byReason = (this.summary.unresolved[kind] ??= {
      unmatched: 0,
      ambiguous: 0,
      lossy: 0,
      hidden: 0,
    });
    byReason[reason]++;
  }
}

function unresolvedOf(res: MatchResult, lines: string[]): Unresolved | undefined {
  if (res.status === "matched") return undefined;
  return { text: lines.join("\n"), reason: res.status };
}

// ---------------------------------------------------------------- mods

function normalizeMods(
  raw: RawKinds,
  matcher: StatMatcher,
  cfg: NormalizeConfig,
  ctx: Context,
): Record<string, unknown>[] {
  const mods = kindOf(raw, "mods");
  const { results } = resolveModStats(mods, matcher, cfg.statScopes.mod);
  const byId = new Map(results.map((r) => [r.modId, r]));

  // tiers: 1 = highest required level in its family
  const families = new Map<string, { id: string; level: number }[]>();
  for (const [id, m] of Object.entries(mods)) {
    const o = obj(m);
    const type = str(o.type);
    const level = num(o.level);
    const group = str(o.group);
    if (!type || !cfg.modTiers.generationTypes.includes(type) || level === undefined || !group)
      continue;
    const key = JSON.stringify([group, type, list(o.domains)]);
    const fam = families.get(key) ?? [];
    fam.push({ id, level });
    families.set(key, fam);
  }
  const tiers = new Map<string, number>();
  for (const fam of families.values()) {
    const levels = [...new Set(fam.map((f) => f.level))].sort((a, b) => b - a);
    for (const f of fam) tiers.set(f.id, levels.indexOf(f.level) + 1);
  }

  return Object.keys(mods)
    .sort()
    .map((id) => {
      const o = obj(mods[id]);
      const res = byId.get(id);
      if (!res) throw new Error(`internal: no stat result for mod ${id}`);
      const keys = list(o.weightKey);
      const vals = list(o.weightVal);
      if (keys.length !== vals.length)
        throw new Error(`mod ${id}: weightKey and weightVal differ in length`);
      const text = modLines(o).join("\n");
      const tier = tiers.get(id);
      const group = str(o.group);
      const type = str(o.type);
      if (!type) ctx.summary.modsWithoutGenerationType++;
      if (res.emptyGroupHashes.length > 0) {
        ctx.summary.modsWithHiddenStatGroups++;
        for (const tradeHash of res.emptyGroupHashes)
          ctx.hiddenStatGroups.push({ modId: id, tradeHash });
      }
      const unresolved = res.unresolved.map((u) => ({
        text: u.lines.join("\n"),
        // a line without trade hash that text matching could not place is simply unmatched
        reason: u.reason === "no-trade-hash" ? ("unmatched" as const) : u.reason,
      }));
      for (const u of unresolved) ctx.countUnresolved("mod", u.reason);
      return {
        id,
        groups: group ? [group] : [],
        generationType: type ?? cfg.modGenerationTypeFallback,
        domains: list(o.domains).filter((d): d is string => typeof d === "string"),
        ...(tier !== undefined ? { tier } : {}),
        requiredLevel: ctx.requireNum("mod", id, "level", o.level),
        stats: res.stats,
        spawnWeights: keys.map((k, i) => ({
          tag: String(k),
          weight: ctx.requireNum("mod", id, `weightVal[${String(i)}]`, vals[i]),
        })),
        tags: list(o.modTags).filter((t): t is string => typeof t === "string"),
        ...(text ? { text } : {}),
        ...(unresolved.length > 0 ? { unresolved } : {}),
      };
    });
}

// ---------------------------------------------------------------- base items

function normalizeBaseItems(
  raw: RawKinds,
  cfg: NormalizeConfig,
  ctx: Context,
): Record<string, unknown>[] {
  const bases = kindOf(raw, "itemBases");
  const mods = kindOf(raw, "mods");
  // implicit text -> mod ids with exactly that text
  const byText = new Map<string, string[]>();
  for (const [id, m] of Object.entries(mods)) {
    const text = modLines(obj(m)).join("\n");
    if (!text) continue;
    byText.set(text, [...(byText.get(text) ?? []), id]);
  }
  return Object.keys(bases)
    .sort()
    .map((id) => {
      const b = obj(bases[id]);
      const req = obj(b.req);
      const attributes: Record<string, number> = {};
      for (const [k, v] of Object.entries(req)) {
        if (k !== "level" && typeof v === "number") attributes[k] = v;
      }
      const properties: Record<string, number> = {};
      for (const group of cfg.baseItemPropertyGroups) {
        for (const [k, v] of Object.entries(obj(b[group]))) {
          if (typeof v === "number") properties[`${group}.${k}`] = v;
        }
      }
      const implicitModIds: string[] = [];
      const implicit = str(b.implicit);
      if (implicit) {
        const candidates = byText.get(implicit) ?? [];
        if (candidates.length === 1) implicitModIds.push(candidates[0] as string);
        else
          ctx.warn(
            "baseItem",
            id,
            `implicit "${implicit}" matches ${String(candidates.length)} mods`,
          );
      }
      const level = num(req.level);
      const socketCapacity = num(b.socketLimit);
      return {
        id,
        name: id,
        itemClass: ctx.requireStr("baseItem", id, "type", b.type),
        tags: trueKeys(b.tags),
        requirements: { ...(level !== undefined ? { level } : {}), attributes },
        implicitModIds,
        properties,
        ...(socketCapacity !== undefined ? { socketCapacity } : {}),
      };
    });
}

// ---------------------------------------------------------------- uniques

function normalizeUniques(
  raw: RawKinds,
  matcher: StatMatcher,
  cfg: NormalizeConfig,
  ctx: Context,
): Record<string, unknown>[] {
  const uniques = kindOf(raw, "uniques");
  return Object.keys(uniques)
    .sort()
    .map((id) => {
      const u = obj(uniques[id]);
      const variantNames = list(u.variants).filter((v): v is string => typeof v === "string");
      const variants = variantNames.map((name, i) => ({ id: String(i + 1), name }));
      const variantIds = new Set(variants.map((v) => v.id));
      const lines = [...list(u.implicitModLines), ...list(u.explicitModLines)].map(obj);
      // PoB keeps one display line per entry; each is matched on its own
      const mods: Record<string, unknown>[] = [];
      for (const line of lines) {
        const text = str(line.line);
        if (!text) continue;
        const listed = list(line.variants).map(String);
        const known = listed.filter((v) => variantIds.has(v));
        for (const v of listed.filter((x) => !variantIds.has(x)))
          ctx.warn("uniqueItem", id, `line "${text}": unknown variant ${v} dropped`);
        if (listed.length > 0 && known.length === 0) {
          // only for variants the item does not have: PoB never shows it
          ctx.warn("uniqueItem", id, `line "${text}" dropped: none of its variants exist`);
          continue;
        }
        const [res] = matcher.matchLines([text], cfg.statScopes.mod) as [MatchResult];
        const unresolved = unresolvedOf(res, [text]);
        if (unresolved) ctx.countUnresolved("uniqueItem", unresolved.reason);
        mods.push({
          stats: res.status === "matched" ? res.stats : [],
          text,
          ...(known.length > 0 ? { variantIds: known } : {}),
          ...(unresolved ? { unresolved: [unresolved] } : {}),
        });
      }
      return {
        id,
        name: ctx.requireStr("uniqueItem", id, "title", u.title),
        baseItemId: ctx.requireStr("uniqueItem", id, "baseName", u.baseName),
        mods,
        variants,
      };
    });
}

// ---------------------------------------------------------------- gems

/** PoB marks a per-level stat value that is stored literally (not interpolated). */
const LITERAL_INTERPOLATION = 1;

/**
 * Per-level stats of a gem: the literal values of its first stat set, keyed
 * by stat id, plus the set's constant stats. Values PoB interpolates at run
 * time and further stat sets (alternate modes) are counted, not mapped.
 */
function gemLevelStats(
  statSet: Obj | undefined,
  level: number,
  gemId: string,
  ctx: Context,
): Record<string, number> {
  const stats: Record<string, number> = {};
  if (!statSet) return stats;
  for (const c of list(statSet.constantStats)) {
    const [statId, value] = list(c);
    if (typeof statId === "string" && typeof value === "number") stats[statId] = value;
  }
  const statIds = list(statSet.stats);
  if (statIds.length === 0) return stats;
  const lv = list(statSet.levels)[level - 1];
  if (lv === undefined) {
    ctx.warn("gem", gemId, `stat set has no level ${String(level)}`);
    return stats;
  }
  const values = obj(lv);
  const interpolation = list(values.statInterpolation);
  statIds.forEach((statId, i) => {
    const value = num(values[String(i + 1)]);
    // stats after the valued ones are flags and carry no per-level value
    if (typeof statId !== "string" || value === undefined) return;
    if (interpolation[i] === LITERAL_INTERPOLATION) stats[statId] = value;
    else ctx.summary.gemInterpolatedStatValues++;
  });
  return stats;
}

function normalizeGems(raw: RawKinds, ctx: Context): Record<string, unknown>[] {
  const gems = kindOf(raw, "gems");
  const gemLevels = kindOf(raw, "gemLevels");
  const skills = kindOf(raw, "skills");
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const pobId of Object.keys(gems).sort()) {
    const g = obj(gems[pobId]);
    const id = ctx.requireStr("gem", pobId, "gameId", g.gameId);
    if (seen.has(id)) {
      ctx.warn("gem", id, `duplicate gameId (PoB gem ${pobId}); later entry skipped`);
      continue;
    }
    seen.add(id);
    const lv = obj(gemLevels[pobId]);
    const effectId = str(lv.grantedEffectId);
    const skill = effectId !== undefined ? skills[effectId] : undefined;
    if (effectId !== undefined && skill === undefined)
      ctx.error("gem", id, `granted effect ${effectId} missing from skills`);
    const [statSet, ...otherSets] = list(obj(skill).statSets).map(obj);
    ctx.summary.gemAdditionalStatSets += otherSets.length;
    const levels = list(lv.levels).map((l) => {
      const o = obj(l);
      const level = ctx.requireNum("gem", id, "level number", o.level);
      const fields = ctx.summary.gemLevelFieldsNotInContract;
      for (const field of Object.keys(obj(o.values))) fields[field] = (fields[field] ?? 0) + 1;
      const attributes: Record<string, number> = {};
      for (const [k, v] of Object.entries(obj(o.attributes)))
        if (typeof v === "number") attributes[k] = v;
      const reqLevel = num(o.levelRequirement);
      return {
        level,
        requirements: { ...(reqLevel !== undefined ? { level: reqLevel } : {}), attributes },
        stats: gemLevelStats(statSet, level, id, ctx),
      };
    });
    if (levels.length === 0) ctx.error("gem", id, `no level data for PoB gem ${pobId}`);
    out.push({
      id,
      name: ctx.requireStr("gem", id, "name", g.name),
      kind: ctx.requireStr("gem", id, "gemType", g.gemType),
      tags: trueKeys(g.tags),
      levels,
    });
  }
  return out;
}

// ---------------------------------------------------------------- passive tree

interface RawNode {
  skill: number;
  data: Obj;
}

function normalizeTree(
  raw: RawKinds,
  matcher: StatMatcher,
  cfg: NormalizeConfig,
  ctx: Context,
): Pick<CatalogEntities, "passiveNode" | "passiveGroup" | "characterClass" | "ascendancy"> {
  const tree = kindOf(raw, "passiveTree");
  const nodes: RawNode[] = [];
  const classes: { name: string; data: Obj }[] = [];
  const rawGroups = new Map<string, Obj>();
  let constants: Obj | undefined;
  for (const [key, entry] of Object.entries(tree)) {
    const e = obj(entry);
    const data = obj(e.data);
    if (e.kind === "group") {
      rawGroups.set(key.replace(/^group:/, ""), data);
    } else if (e.kind === "constants") {
      constants = data;
    } else if (e.kind === "node") {
      const skill = num(data.skill);
      if (skill === undefined) throw new Error(`passive tree entry ${key}: node without skill id`);
      nodes.push({ skill, data });
    } else if (e.kind === "class") {
      classes.push({ name: ctx.requireStr("characterClass", key, "name", data.name), data });
    }
  }
  nodes.sort((a, b) => a.skill - b.skill);
  const nodeIds = new Set(nodes.map((n) => n.skill));
  const imageOnly = new Set(nodes.filter((n) => n.data.isOnlyImage === true).map((n) => n.skill));
  const geometry = treeGeometry(rawGroups, constants, ctx);
  const nodeBySkill = new Map(nodes.map((n) => [n.skill, n.data]));
  const pointOf = (data: Obj): { x: number; y: number } | undefined =>
    geometry.point(num(data.group), num(data.orbit), num(data.orbitIndex));
  const classNames = new Set(classes.map((c) => c.name));

  // nodes name their ascendancy by display name, so names must be unique
  const ascByName = new Map<string, { id: string; classId: string; name: string }>();
  for (const c of classes) {
    for (const a of list(c.data.ascendancies).map(obj)) {
      const id = ctx.requireStr("ascendancy", c.name, "internalId", a.internalId);
      const name = ctx.requireStr("ascendancy", id, "name", a.name);
      const other = ascByName.get(name);
      if (other)
        ctx.error("ascendancy", id, `name "${name}" also used by ${other.id}; nodes are ambiguous`);
      else ascByName.set(name, { id, classId: c.name, name });
    }
  }

  const passiveNode = nodes.map(({ skill, data }) => {
    const id = String(skill);
    const flags = cfg.passiveNodeKinds.flags.find(([flag]) => data[flag] === true);
    const statLines = list(data.stats).filter((s): s is string => typeof s === "string");
    const stats: { statId?: string; text: string }[] = [];
    for (const group of matcher.matchLineGroups(statLines, cfg.statScopes.passiveNode)) {
      const text = group.lines.join("\n");
      const res = group.result;
      if (res.status === "matched" && res.stats.length > 0) {
        for (const st of res.stats) stats.push({ statId: st.statId, text });
      } else {
        stats.push({ text });
        const u = unresolvedOf(res, group.lines);
        if (u) {
          // PassiveNode has no `unresolved` field: the reason goes to the findings
          ctx.unresolved.push({ kind: "passiveNode", id, ...u });
          ctx.countUnresolved("passiveNode", u.reason);
        }
      }
    }
    // PoB itself skips connections to nodes missing from the tree data
    // ("missing node" on load); they are dropped here too, each one reported.
    // Image-only nodes (PoB type "OnlyImage") are never linked in PoB, so
    // their connections are dropped silently, as PoB does.
    const connections: string[] = [];
    for (const c of list(data.connections)) {
      const target = num(obj(c).id);
      if (target === undefined) continue;
      if (imageOnly.has(skill) || imageOnly.has(target)) continue;
      if (nodeIds.has(target)) connections.push(String(target));
      else ctx.warn("passiveNode", id, `connection to missing node ${String(target)} dropped`);
    }
    const point = pointOf(data);
    if (!point) ctx.warn("passiveNode", id, "no tree position (group or orbit missing in source)");
    const arcs: { to: string; radius: number; side: 1 | -1 }[] = [];
    for (const c of list(data.connections)) {
      const target = num(obj(c).id);
      const orbit = num(obj(c).orbit);
      if (target === undefined || orbit === undefined || orbit === 0 || !point) continue;
      if (!connections.includes(String(target))) continue;
      const other = nodeBySkill.get(target);
      const otherPoint = other ? pointOf(other) : undefined;
      if (!otherPoint) continue;
      const radius = geometry.radius(Math.abs(orbit));
      // PoB (PassiveTree:BuildConnector) draws a straight line when the
      // orbit is unknown or the nodes are further apart than its diameter
      if (radius === undefined) {
        ctx.warn(
          "passiveNode",
          id,
          `connection to ${String(target)}: unknown orbit ${String(orbit)}`,
        );
        continue;
      }
      const dist = Math.hypot(otherPoint.x - point.x, otherPoint.y - point.y);
      if (dist < radius * 2) arcs.push({ to: String(target), radius, side: orbit > 0 ? 1 : -1 });
    }
    const classStartFor: string[] = [];
    for (const c of list(data.classesStart)) {
      if (typeof c !== "string") continue;
      if (classNames.has(c)) classStartFor.push(c);
      else ctx.warn("passiveNode", id, `start node for unknown class "${c}" dropped`);
    }
    const asc = str(data.ascendancyName);
    const ascendancy = asc ? ascByName.get(asc) : undefined;
    if (asc && !ascendancy) ctx.warn("passiveNode", id, `unknown ascendancy "${asc}"`);
    const group = num(data.group);
    return {
      id,
      pobNodeId: skill,
      name: ctx.requireStr("passiveNode", id, "name", data.name),
      kind: flags ? flags[1] : cfg.passiveNodeKinds.default,
      stats,
      position: {
        groupId:
          group !== undefined
            ? String(group)
            : ctx.requireStr("passiveNode", id, "group", undefined),
        orbit: ctx.requireNum("passiveNode", id, "orbit", data.orbit),
        orbitIndex: ctx.requireNum("passiveNode", id, "orbitIndex", data.orbitIndex),
        ...(point ? { point } : {}),
      },
      connections,
      arcs,
      classStartFor,
      ...(ascendancy ? { ascendancyId: ascendancy.id } : {}),
    };
  });

  const characterClass = classes
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => {
      const baseAttributes: Record<string, number> = {};
      for (const [k, v] of Object.entries(c.data)) {
        if (k.startsWith(cfg.classAttributePrefix) && typeof v === "number") {
          baseAttributes[k.slice(cfg.classAttributePrefix.length)] = v;
        }
      }
      const starts = nodes.filter((n) => list(n.data.classesStart).includes(c.name));
      if (starts.length === 0) ctx.error("characterClass", c.name, "no start node");
      if (starts.length > 1)
        ctx.warn(
          "characterClass",
          c.name,
          `${String(starts.length)} start nodes; the lowest id is used`,
        );
      return {
        id: c.name,
        name: c.name,
        baseAttributes,
        startNodeId: starts[0] ? String(starts[0].skill) : "",
        ascendancyIds: list(c.data.ascendancies)
          .map((a) => str(obj(a).internalId))
          .filter((x): x is string => x !== undefined),
      };
    });

  const ascendancy = [...ascByName.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((a) => {
      const own = nodes.filter((n) => n.data.ascendancyName === a.name);
      const start = own.find((n) => n.data.isAscendancyStart === true);
      if (own.length === 0) ctx.warn("ascendancy", a.id, "no passive nodes in the tree");
      return {
        id: a.id,
        name: a.name,
        classId: a.classId,
        ...(start ? { startNodeId: String(start.skill) } : {}),
        nodeIds: own.map((n) => String(n.skill)),
      };
    });

  return { passiveNode, passiveGroup: geometry.groups, characterClass, ascendancy };
}

/** Tree units are rounded so snapshots and diffs stay byte-stable. */
function roundUnit(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Node positions as PoB computes them (PassiveTree:ProcessNode): group centre
 * plus the orbit radius in the direction of the orbit angle, with y growing
 * downwards. Radii and angles come from the tree's `constants`; nothing here
 * is a game value.
 */
function treeGeometry(
  rawGroups: ReadonlyMap<string, Obj>,
  constants: Obj | undefined,
  ctx: Context,
): {
  groups: Record<string, unknown>[];
  radius(orbit: number): number | undefined;
  point(
    group: number | undefined,
    orbit: number | undefined,
    orbitIndex: number | undefined,
  ): { x: number; y: number } | undefined;
} {
  if (!constants) ctx.error("passiveGroup", "constants", "source has no tree constants");
  const radii = list(constants?.orbitRadii).map((r) => num(r));
  const angles = list(constants?.orbitAnglesByOrbit).map((a) => list(a).map((x) => num(x)));
  if (constants && radii.length === 0)
    ctx.error("passiveGroup", "constants", "source has no orbitRadii");
  if (constants && angles.length === 0)
    ctx.error("passiveGroup", "constants", "source has no orbitAnglesByOrbit");
  const radius = (orbit: number) => radii[orbit];

  const centers = new Map<string, { x: number; y: number }>();
  const groups: Record<string, unknown>[] = [];
  const ids = [...rawGroups.keys()].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  for (const id of ids) {
    const g = rawGroups.get(id) ?? {};
    const x = num(g.x);
    const y = num(g.y);
    if (x === undefined || y === undefined) {
      ctx.error("passiveGroup", id, "source has no x/y");
      continue;
    }
    const center = { x: roundUnit(x), y: roundUnit(y) };
    centers.set(id, { x, y });
    const orbitRadii: number[] = [];
    for (const o of list(g.orbits)) {
      const r = typeof o === "number" ? radius(o) : undefined;
      if (r === undefined) ctx.error("passiveGroup", id, `unknown orbit ${JSON.stringify(o)}`);
      else orbitRadii.push(r);
    }
    groups.push({ id, center, orbitRadii });
  }

  return {
    groups,
    radius,
    point(group, orbit, orbitIndex) {
      if (group === undefined || orbit === undefined || orbitIndex === undefined) return undefined;
      const c = centers.get(String(group));
      const r = radius(orbit);
      const angle = angles[orbit]?.[orbitIndex];
      if (!c || r === undefined || angle === undefined) return undefined;
      return {
        x: roundUnit(c.x + Math.sin(angle) * r),
        y: roundUnit(c.y - Math.cos(angle) * r),
      };
    },
  };
}

// ---------------------------------------------------------------- stat translations

/** {n} or {n:format}; the format code is kept as the placeholder's formatter. */
const PLACEHOLDER = /\{(\d*)(?::([^{}]*))?\}/g;
const DEFAULT_FORMAT = "d";

function normalizeStatTranslations(
  raw: RawKinds,
  cfg: NormalizeConfig,
  ctx: Context,
): Record<string, unknown>[] {
  const descriptions = kindOf(raw, "statDescriptions");
  const counts = ctx.summary.statTranslations;
  return Object.keys(descriptions)
    .sort()
    .flatMap((id) => {
      counts.descriptions++;
      const d = obj(descriptions[id]);
      const statIds = list(d.stats).filter((s): s is string => typeof s === "string");
      const all = list(d.variants).map(obj);
      const own = all.filter((v) => v.gemQuality !== true);
      counts.gemQualityVariantsSkipped += all.length - own.length;
      const variants = own
        .map((v) => {
          const limits = list(v.limit).map(list);
          const conditions = statIds.map((_, i) => {
            // PoB: a stat without limit entry accepts any value
            const [lo, hi] = limits[i] ?? [];
            if (lo === "!")
              return { ...(typeof hi === "number" ? { min: hi, max: hi } : {}), negated: true };
            return {
              ...(typeof lo === "number" ? { min: lo } : {}),
              ...(typeof hi === "number" ? { max: hi } : {}),
              negated: false,
            };
          });
          const handlersByStat = new Map<number, string[]>();
          for (const h of list(v.handlers).map(obj)) {
            const k = str(h.k);
            const idx = num(h.v);
            if (k && idx !== undefined)
              handlersByStat.set(idx - 1, [...(handlersByStat.get(idx - 1) ?? []), k]);
          }
          const formatters: string[] = [];
          const text = str(v.text) ?? "";
          const template = text.replace(PLACEHOLDER, (_m, n: string, fmt: string | undefined) => {
            const statIndex = n === "" ? 0 : Number(n);
            const format = fmt !== undefined && fmt.length > 0 ? fmt : DEFAULT_FORMAT;
            formatters.push([format, ...(handlersByStat.get(statIndex) ?? [])].join("|"));
            return `{${String(statIndex)}}`;
          });
          return { conditions, template, formatters };
        })
        .filter((v) => {
          if (v.template.length > 0) return true;
          counts.emptyVariantsSkipped++;
          return false;
        });
      if (statIds.length === 0) {
        counts.withoutStats++;
        return [];
      }
      if (variants.length === 0) {
        counts.withoutVariants++;
        return [];
      }
      return [{ id, statIds, lang: cfg.lang, variants }];
    });
}

// ---------------------------------------------------------------- entry

export function normalizeCatalog(
  raw: RawKinds,
  matchers: { mod: StatMatcher; passiveNode: StatMatcher },
  cfg: NormalizeConfig,
): NormalizeResult {
  const ctx = new Context();
  const tree = normalizeTree(raw, matchers.passiveNode, cfg, ctx);
  const entities: CatalogEntities = {
    baseItem: normalizeBaseItems(raw, cfg, ctx),
    mod: normalizeMods(raw, matchers.mod, cfg, ctx),
    uniqueItem: normalizeUniques(raw, matchers.mod, cfg, ctx),
    gem: normalizeGems(raw, ctx),
    ...tree,
    statTranslation: normalizeStatTranslations(raw, cfg, ctx),
  };
  return {
    entities,
    errors: ctx.errors,
    warnings: ctx.warnings,
    unresolved: ctx.unresolved,
    hiddenStatGroups: ctx.hiddenStatGroups,
    summary: ctx.summary,
  };
}
