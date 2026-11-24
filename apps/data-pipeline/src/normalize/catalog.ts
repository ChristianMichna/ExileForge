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
 * Nothing is invented: values PoB does not have are left out (optional
 * fields) and every line whose stats cannot be determined is kept in
 * `unresolved` together with the reason. Validation against the contract and
 * referential integrity run afterwards (validate.ts).
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

export async function loadNormalizeConfig(path: string): Promise<NormalizeConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (cause) {
    throw new Error(`cannot read normalize config ${path}`, { cause });
  }
  const parsed = normalizeConfigSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(`invalid normalize config ${path}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export interface Unresolved {
  text: string;
  reason: "unmatched" | "ambiguous" | "lossy" | "hidden";
}

/** Entities per contract kind, as plain JSON objects (validated in validate.ts). */
export type CatalogEntities = Record<
  | "baseItem"
  | "mod"
  | "uniqueItem"
  | "gem"
  | "passiveNode"
  | "characterClass"
  | "ascendancy"
  | "statTranslation",
  Record<string, unknown>[]
>;

/** A problem found while normalising; the release gate decides what blocks. */
export interface Finding {
  kind: string;
  id: string;
  message: string;
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

function unresolvedOf(res: MatchResult, lines: string[]): Unresolved | undefined {
  if (res.status === "matched") return undefined;
  return { text: lines.join("\n"), reason: res.status };
}

// ---------------------------------------------------------------- mods

function normalizeMods(
  raw: RawKinds,
  matcher: StatMatcher,
  cfg: NormalizeConfig,
): Record<string, unknown>[] {
  const mods = kindOf(raw, "mods");
  const { results } = resolveModStats(mods, matcher, cfg.statScopes.mod);
  const byId = new Map(results.map((r) => [r.modId, r]));

  // tiers: 1 = highest required level in its family
  const families = new Map<string, { id: string; level: number }[]>();
  for (const [id, m] of Object.entries(mods)) {
    const o = obj(m);
    const type = str(o.type);
    if (!type || !cfg.modTiers.generationTypes.includes(type)) continue;
    const group = str(o.group);
    if (!group) continue;
    const key = JSON.stringify([group, type, list(o.domains)]);
    const fam = families.get(key) ?? [];
    fam.push({ id, level: num(o.level) ?? 0 });
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
      return {
        id,
        groups: group ? [group] : [],
        generationType: str(o.type) ?? cfg.modGenerationTypeFallback,
        domains: list(o.domains).filter((d): d is string => typeof d === "string"),
        ...(tier !== undefined ? { tier } : {}),
        requiredLevel: num(o.level) ?? 0,
        stats: res.stats,
        spawnWeights: keys.map((k, i) => ({ tag: String(k), weight: num(vals[i]) ?? -1 })),
        tags: list(o.modTags).filter((t): t is string => typeof t === "string"),
        ...(text ? { text } : {}),
        ...(res.unresolved.length > 0
          ? {
              unresolved: res.unresolved.map((u) => ({
                text: u.lines.join("\n"),
                // a line without trade hash that text matching could not place is simply unmatched
                reason: u.reason === "no-trade-hash" ? "unmatched" : u.reason,
              })),
            }
          : {}),
      };
    });
}

// ---------------------------------------------------------------- base items

function normalizeBaseItems(
  raw: RawKinds,
  cfg: NormalizeConfig,
  findings: Finding[],
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
          findings.push({
            kind: "baseItem",
            id,
            message: `implicit "${implicit}" matches ${String(candidates.length)} mods`,
          });
      }
      const level = num(req.level);
      const socketCapacity = num(b.socketLimit);
      return {
        id,
        name: id,
        itemClass: str(b.type) ?? "",
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
): Record<string, unknown>[] {
  const uniques = kindOf(raw, "uniques");
  return Object.keys(uniques)
    .sort()
    .map((id) => {
      const u = obj(uniques[id]);
      const lines = [...list(u.implicitModLines), ...list(u.explicitModLines)].map(obj);
      // group consecutive lines with the same variant set, then match
      const mods: Record<string, unknown>[] = [];
      for (const line of lines) {
        const text = str(line.line);
        if (!text) continue;
        const variants = list(line.variants).map(String);
        const [res] = matcher.matchLines([text], cfg.statScopes.mod) as [MatchResult];
        const unresolved = unresolvedOf(res, [text]);
        mods.push({
          stats: res.status === "matched" ? res.stats : [],
          text,
          ...(variants.length > 0 ? { variantIds: variants } : {}),
          ...(unresolved ? { unresolved: [unresolved] } : {}),
        });
      }
      const variantNames = list(u.variants).filter((v): v is string => typeof v === "string");
      return {
        id,
        name: str(u.title) ?? id,
        baseItemId: str(u.baseName) ?? "",
        mods,
        variants: variantNames.map((name, i) => ({ id: String(i + 1), name })),
      };
    });
}

// ---------------------------------------------------------------- gems

function normalizeGems(raw: RawKinds, findings: Finding[]): Record<string, unknown>[] {
  const gems = kindOf(raw, "gems");
  const gemLevels = kindOf(raw, "gemLevels");
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const pobId of Object.keys(gems).sort()) {
    const g = obj(gems[pobId]);
    const id = str(g.gameId) ?? pobId;
    if (seen.has(id)) {
      findings.push({
        kind: "gem",
        id,
        message: `duplicate gameId (PoB gem ${pobId}); later entry skipped`,
      });
      continue;
    }
    seen.add(id);
    const lv = obj(gemLevels[pobId]);
    const levels = list(lv.levels).map((l) => {
      const o = obj(l);
      const values: Record<string, number> = {};
      for (const [k, v] of Object.entries(obj(o.values))) if (typeof v === "number") values[k] = v;
      const attributes: Record<string, number> = {};
      for (const [k, v] of Object.entries(obj(o.attributes)))
        if (typeof v === "number") attributes[k] = v;
      return {
        level: num(o.level) ?? 0,
        requirements: { level: num(o.levelRequirement) ?? 0, attributes },
        stats: values,
      };
    });
    if (levels.length === 0)
      findings.push({ kind: "gem", id, message: `no level data for PoB gem ${pobId}` });
    out.push({
      id,
      name: str(g.name) ?? id,
      kind: str(g.gemType) ?? "",
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
  findings: Finding[],
): Pick<CatalogEntities, "passiveNode" | "characterClass" | "ascendancy"> {
  const tree = kindOf(raw, "passiveTree");
  const nodes: RawNode[] = [];
  const classes: { name: string; data: Obj }[] = [];
  for (const entry of Object.values(tree)) {
    const e = obj(entry);
    const data = obj(e.data);
    if (e.kind === "node") {
      const skill = num(data.skill);
      if (skill === undefined)
        throw new Error(`passive node without skill id: ${JSON.stringify(data).slice(0, 80)}`);
      nodes.push({ skill, data });
    } else if (e.kind === "class") {
      classes.push({ name: str(data.name) ?? "", data });
    }
  }
  nodes.sort((a, b) => a.skill - b.skill);
  const nodeIds = new Set(nodes.map((n) => n.skill));
  const classNames = new Set(classes.map((c) => c.name));

  const ascByName = new Map<string, { id: string; classId: string; name: string }>();
  for (const c of classes) {
    for (const a of list(c.data.ascendancies).map(obj)) {
      const id = str(a.internalId) ?? str(a.id);
      const name = str(a.name);
      if (id && name) ascByName.set(name, { id, classId: c.name, name });
    }
  }

  const passiveNode = nodes.map(({ skill, data }) => {
    const flags = cfg.passiveNodeKinds.flags.find(([flag]) => data[flag] === true);
    const statLines = list(data.stats).filter((s): s is string => typeof s === "string");
    const stats: { statId?: string; text: string }[] = [];
    const unresolved: Unresolved[] = [];
    for (const group of matcher.matchLineGroups(statLines, cfg.statScopes.passiveNode)) {
      const text = group.lines.join("\n");
      const res = group.result;
      if (res.status === "matched" && res.stats.length > 0) {
        for (const st of res.stats) stats.push({ statId: st.statId, text });
      } else {
        stats.push({ text });
        const u = unresolvedOf(res, group.lines);
        if (u) unresolved.push(u);
      }
    }
    // PoB itself skips connections to nodes missing from the tree data
    // ("missing node" on load); they are dropped here too, each one reported
    const connections: string[] = [];
    for (const c of list(data.connections)) {
      const target = num(obj(c).id);
      if (target === undefined) continue;
      if (nodeIds.has(target)) connections.push(String(target));
      else
        findings.push({
          kind: "passiveNode",
          id: String(skill),
          message: `connection to missing node ${String(target)} dropped`,
        });
    }
    const classStartFor: string[] = [];
    for (const c of list(data.classesStart)) {
      if (typeof c !== "string") continue;
      if (classNames.has(c)) classStartFor.push(c);
      else
        findings.push({
          kind: "passiveNode",
          id: String(skill),
          message: `start node for unknown class "${c}" dropped`,
        });
    }
    const asc = str(data.ascendancyName);
    const ascendancy = asc ? ascByName.get(asc) : undefined;
    if (asc && !ascendancy) {
      findings.push({
        kind: "passiveNode",
        id: String(skill),
        message: `unknown ascendancy "${asc}"`,
      });
    }
    return {
      id: String(skill),
      pobNodeId: skill,
      name: str(data.name) ?? String(skill),
      kind: flags ? flags[1] : cfg.passiveNodeKinds.default,
      stats,
      position: {
        groupId: String(num(data.group) ?? ""),
        orbit: num(data.orbit) ?? 0,
        orbitIndex: num(data.orbitIndex) ?? 0,
      },
      connections,
      classStartFor,
      ...(ascendancy ? { ascendancyId: ascendancy.id } : {}),
      ...(unresolved.length > 0 ? { unresolved } : {}),
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
      const start = nodes.find((n) => list(n.data.classesStart).includes(c.name));
      return {
        id: c.name,
        name: c.name,
        baseAttributes,
        startNodeId: start ? String(start.skill) : "",
        ascendancyIds: list(c.data.ascendancies)
          .map((a) => str(obj(a).internalId) ?? str(obj(a).id))
          .filter((x): x is string => x !== undefined),
      };
    });

  const ascendancy = [...ascByName.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((a) => {
      const own = nodes.filter((n) => n.data.ascendancyName === a.name);
      const start = own.find((n) => n.data.isAscendancyStart === true);
      return {
        id: a.id,
        name: a.name,
        classId: a.classId,
        ...(start ? { startNodeId: String(start.skill) } : {}),
        nodeIds: own.map((n) => String(n.skill)),
      };
    });

  return { passiveNode, characterClass, ascendancy };
}

// ---------------------------------------------------------------- stat translations

const PLACEHOLDER = /\{(\d*)(?::([+]?d))?\}/g;

function normalizeStatTranslations(raw: RawKinds, cfg: NormalizeConfig): Record<string, unknown>[] {
  const descriptions = kindOf(raw, "statDescriptions");
  return Object.keys(descriptions)
    .sort()
    .flatMap((id) => {
      const d = obj(descriptions[id]);
      const statIds = list(d.stats).filter((s): s is string => typeof s === "string");
      const variants = list(d.variants)
        .map(obj)
        .filter((v) => v.gemQuality !== true)
        .map((v) => {
          const limits = list(v.limit).map(list);
          const conditions = statIds.map((_, i) => {
            const [lo, hi] = limits[i] ?? ["#", "#"];
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
            formatters.push([fmt ?? "d", ...(handlersByStat.get(statIndex) ?? [])].join("|"));
            return `{${String(statIndex)}}`;
          });
          return { conditions, template, formatters };
        })
        .filter((v) => v.template.length > 0);
      if (statIds.length === 0 || variants.length === 0) return [];
      return [{ id, statIds, lang: cfg.lang, variants }];
    });
}

// ---------------------------------------------------------------- entry

export function normalizeCatalog(
  raw: RawKinds,
  matchers: { mod: StatMatcher; passiveNode: StatMatcher },
  cfg: NormalizeConfig,
): { entities: CatalogEntities; findings: Finding[] } {
  const findings: Finding[] = [];
  const tree = normalizeTree(raw, matchers.passiveNode, cfg, findings);
  return {
    entities: {
      baseItem: normalizeBaseItems(raw, cfg, findings),
      mod: normalizeMods(raw, matchers.mod, cfg),
      uniqueItem: normalizeUniques(raw, matchers.mod, cfg),
      gem: normalizeGems(raw, findings),
      ...tree,
      statTranslation: normalizeStatTranslations(raw, cfg),
    },
    findings,
  };
}
