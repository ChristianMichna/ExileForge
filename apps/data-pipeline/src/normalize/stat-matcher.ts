import { z } from "zod";

/*
 * Reverse of PoB's StatDescriber: maps a rendered mod line such as
 * "+(5-8) to Strength" back to stat ids and raw value ranges, using the stat
 * description templates from the raw snapshot. Deterministic, no game
 * knowledge in code: templates, limits and handlers all come from PoB data.
 * A line that cannot be mapped unambiguously is reported, never guessed.
 */

/** Lua has no empty array: the extractor writes an empty table as {}. */
const luaArray = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (v) =>
      typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0
        ? []
        : v,
    z.array(item),
  );

const limitBound = z.union([z.number(), z.literal("#"), z.literal("!")]);
export const rawStatDescriptionSchema = z.object({
  scope: z.string().min(1),
  order: z.number(),
  parent: z.string().min(1).optional(),
  tradeHash: z.number().int().nonnegative(),
  stats: z.array(z.string().min(1)).min(1),
  variants: luaArray(
    z.object({
      limit: luaArray(z.tuple([limitBound, limitBound])),
      text: z.string(),
      handlers: luaArray(
        z.object({ k: z.string().min(1), v: z.union([z.number().int().positive(), z.boolean()]) }),
      ).default([]),
      gemQuality: z.boolean().optional(),
    }),
  ).default([]),
});
export type RawStatDescription = z.infer<typeof rawStatDescriptionSchema>;

export interface StatValue {
  statId: string;
  min: number;
  max: number;
}

export type MatchResult =
  | { status: "matched"; descriptionId: string; stats: StatValue[] }
  /** the description is known but the display rounds, so raw values are not exact */
  | { status: "lossy"; line: string; descriptionId: string }
  /** the description is known but its text shows no value, so the stat value is unknown */
  | { status: "hidden"; line: string; descriptionId: string; statIds: string[] }
  | { status: "unmatched"; line: string }
  | {
      status: "ambiguous";
      line: string;
      descriptionIds: string[];
      /** what each description would read as; absent when the line only matches hidden values */
      candidates?: { descriptionId: string; stats: StatValue[] }[];
    };

type Inverse = (v: number) => number;

/** Inverse of PoB's display handlers (applySpecial); keyed by handler id. */
const INVERSE: Readonly<Record<string, Inverse | "noop">> = {
  negate: (v) => -v,
  invert_chance: (v) => 100 - v,
  negate_and_double: (v) => -v / 2,
  divide_by_two_0dp: (v) => v * 2,
  divide_by_three: (v) => v * 3,
  divide_by_four: (v) => v * 4,
  divide_by_five: (v) => v * 5,
  divide_by_six: (v) => v * 6,
  divide_by_ten_0dp: (v) => v * 10,
  divide_by_ten_1dp: (v) => v * 10,
  divide_by_ten_1dp_if_required: (v) => v * 10,
  divide_by_twelve: (v) => v * 12,
  divide_by_fifteen_0dp: (v) => v * 15,
  divide_by_twenty: (v) => v * 20,
  divide_by_twenty_then_double_0dp: (v) => v * 10,
  divide_by_fifty: (v) => v * 50,
  divide_by_one_hundred: (v) => v * 100,
  divide_by_one_hundred_0dp: (v) => v * 100,
  divide_by_one_hundred_1dp: (v) => v * 100,
  divide_by_one_hundred_2dp: (v) => v * 100,
  divide_by_one_hundred_2dp_if_required: (v) => v * 100,
  divide_by_one_hundred_and_negate: (v) => -v * 100,
  divide_by_one_thousand: (v) => v * 1000,
  divide_by_ten_thousand_1dp: (v) => v * 10000,
  per_minute_to_per_second: (v) => v * 60,
  per_minute_to_per_second_0dp: (v) => v * 60,
  per_minute_to_per_second_1dp: (v) => v * 60,
  per_minute_to_per_second_2dp: (v) => v * 60,
  per_minute_to_per_second_2dp_if_required: (v) => v * 60,
  milliseconds_to_seconds: (v) => v * 1000,
  milliseconds_to_seconds_halved: (v) => v * 2000,
  milliseconds_to_seconds_0dp: (v) => v * 1000,
  milliseconds_to_seconds_1dp: (v) => v * 1000,
  milliseconds_to_seconds_2dp: (v) => v * 1000,
  milliseconds_to_seconds_2dp_if_required: (v) => v * 1000,
  deciseconds_to_seconds: (v) => v * 10,
  "30%_of_value": (v) => v / 0.3,
  "60%_of_value": (v) => v / 0.6,
  multiplicative_damage_modifier: (v) => v - 100,
  multiplicative_permyriad_damage_modifier: (v) => (v - 100) * 100,
  times_one_point_five: (v) => v / 1.5,
  double: (v) => v / 2,
  multiply_by_four: (v) => v / 4,
  multiply_by_four_and_negate: (v) => -v / 4,
  multiply_by_ten: (v) => v / 10,
  times_twenty: (v) => v / 20,
  multiply_by_one_hundred: (v) => v / 100,
  plus_two_hundred: (v) => v - 200,
  reminderstring: "noop",
  canonical_line: "noop",
  canonical_stat: "noop",
};

// PoB's round(x, n) and floor(x, n) (Modules/Common.lua)
const pobRound = (x: number, n = 0) => Math.floor(x * 10 ** n + 0.5) / 10 ** n;
// PoB adds 0.0001 before flooring
const pobFloor = (x: number, n = 0) => Math.floor(x * 10 ** n + 0.0001) / 10 ** n;

/**
 * Display handlers that round (PoB's applySpecial). Their inverse is only
 * exact if no neighbouring raw value renders to the same text; that is
 * checked with these forward functions.
 */
const ROUNDING: Readonly<Record<string, (v: number) => number>> = {
  divide_by_two_0dp: (v) => pobRound(v / 2),
  divide_by_ten_0dp: (v) => pobRound(v / 10),
  divide_by_ten_1dp: (v) => pobRound(v / 10, 1),
  divide_by_ten_1dp_if_required: (v) => pobRound(v / 10, 1),
  divide_by_fifteen_0dp: (v) => pobRound(v / 15),
  divide_by_twenty_then_double_0dp: (v) => pobRound(v / 20) * 2,
  divide_by_one_hundred_0dp: (v) => pobRound(v / 100),
  divide_by_one_hundred_1dp: (v) => pobRound(v / 100, 1),
  divide_by_one_hundred_2dp: (v) => pobRound(v / 100, 2),
  divide_by_one_hundred_2dp_if_required: (v) => pobRound(v / 100, 2),
  divide_by_ten_thousand_1dp: (v) => pobRound(v / 10000, 1),
  per_minute_to_per_second: (v) => pobFloor(v / 60, 1),
  per_minute_to_per_second_0dp: (v) => pobRound(v / 60),
  per_minute_to_per_second_1dp: (v) => pobRound(v / 60, 1),
  per_minute_to_per_second_2dp: (v) => pobRound(v / 60, 2),
  per_minute_to_per_second_2dp_if_required: (v) => pobRound(v / 60, 2),
  milliseconds_to_seconds_0dp: (v) => pobRound(v / 1000),
  milliseconds_to_seconds_1dp: (v) => pobRound(v / 1000, 1),
  milliseconds_to_seconds_2dp: (v) => pobRound(v / 1000, 2),
  milliseconds_to_seconds_2dp_if_required: (v) => pobRound(v / 1000, 2),
};

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

const NUM = String.raw`\d+(?:\.\d+)?`;
// one displayed value: 12 | -12 | +12 | (5-8) | +(5-8) | -(5-8) | (-8--5)
const VALUE = String.raw`([+-]?)(?:\((-?${NUM})-(-?${NUM})\)|(${NUM}))`;
const PLACEHOLDER = /\{(\d*)(?::([+]?)d)?\}/g;
const VALUE_GLOBAL = new RegExp(VALUE, "g");

/** Shape key shared by a template and the lines it renders: every value becomes "#". */
export function shapeKey(text: string): string {
  return text.replace(VALUE_GLOBAL, "#");
}

interface CompiledVariant {
  descriptionId: string;
  description: RawStatDescription;
  variant: RawStatDescription["variants"][number];
  /** position of the variant in its description (PoB takes the first fitting one) */
  variantIndex: number;
  regex: RegExp;
  /** stat index (0-based) for each capture group set, in text order */
  placeholders: number[];
  usable: boolean;
  key: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileVariant(
  descriptionId: string,
  description: RawStatDescription,
  variant: CompiledVariant["variant"],
  variantIndex: number,
): CompiledVariant {
  const text = variant.text.replaceAll("%%", "%");
  const placeholders: number[] = [];
  let pattern = "";
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    pattern += escapeRegex(text.slice(last, m.index));
    placeholders.push(m[1] === "" || m[1] === undefined ? 0 : Number(m[1]));
    pattern += VALUE;
    last = m.index + m[0].length;
  }
  pattern += escapeRegex(text.slice(last));
  const usable =
    variant.handlers.every((h) => INVERSE[h.k] !== undefined) &&
    placeholders.every((p) => p < description.stats.length);
  return {
    descriptionId,
    description,
    variant,
    variantIndex,
    regex: new RegExp(`^${pattern}$`),
    placeholders,
    usable,
    key: shapeKey(text.replace(PLACEHOLDER, "0")),
  };
}

function within(limit: [number | "#" | "!", number | "#" | "!"], value: number): boolean {
  const [lo, hi] = limit;
  if (lo === "!") return typeof hi === "number" ? value !== hi : true;
  if (typeof lo === "number" && value < lo) return false;
  if (typeof hi === "number" && value > hi) return false;
  return true;
}

function round(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

function hiddenResult(line: string, cv: CompiledVariant): MatchResult {
  return {
    status: "hidden",
    line,
    descriptionId: cv.descriptionId,
    statIds: [...cv.description.stats],
  };
}

export class StatMatcher {
  private readonly byScope = new Map<string, CompiledVariant[]>();
  /** PoB trade hash -> compiled variants of the descriptions with that hash */
  private readonly byHash = new Map<number, CompiledVariant[]>();
  /** scope -> shape key -> variants in description order */
  private readonly index = new Map<string, Map<string, CompiledVariant[]>>();
  private readonly parents = new Map<string, string | undefined>();

  constructor(descriptions: Readonly<Record<string, unknown>>) {
    const ids = Object.keys(descriptions).sort();
    for (const id of ids) {
      const parsed = rawStatDescriptionSchema.safeParse(descriptions[id]);
      if (!parsed.success) {
        throw new Error(`invalid stat description ${id}: ${z.prettifyError(parsed.error)}`);
      }
      const d = parsed.data;
      this.parents.set(d.scope, d.parent);
      const list = this.byScope.get(d.scope) ?? [];
      const hashList = this.byHash.get(d.tradeHash) ?? [];
      for (const [index, v] of d.variants.entries()) {
        if (v.gemQuality) continue;
        const cv = compileVariant(id, d, v, index);
        list.push(cv);
        hashList.push(cv);
      }
      this.byHash.set(d.tradeHash, hashList);
      this.byScope.set(d.scope, list);
    }
    for (const [scope, list] of this.byScope) {
      list.sort((a, b) => a.description.order - b.description.order);
      const byKey = new Map<string, CompiledVariant[]>();
      for (const cv of list) {
        if (!cv.usable) continue;
        const bucket = byKey.get(cv.key) ?? [];
        bucket.push(cv);
        byKey.set(cv.key, bucket);
      }
      this.index.set(scope, byKey);
    }
  }

  /** Scope chain from the given scope up through its parents. */
  scopeChain(scope: string): string[] {
    const chain: string[] = [];
    let s: string | undefined = scope;
    while (s !== undefined) {
      if (chain.includes(s)) throw new Error(`stat description scope cycle at ${s}`);
      if (!this.byScope.has(s)) throw new Error(`unknown stat description scope ${s}`);
      chain.push(s);
      s = this.parents.get(s);
    }
    return chain;
  }

  private tryVariant(
    cv: CompiledVariant,
    line: string,
  ): StatValue[] | "lossy" | "hidden" | undefined {
    if (!cv.usable) return undefined;
    const m = cv.regex.exec(line);
    if (!m) return undefined;
    const statCount = cv.description.stats.length;
    const display: ({ min: number; max: number } | undefined)[] = Array.from(
      { length: statCount },
      () => undefined,
    );
    for (let i = 0; i < cv.placeholders.length; i++) {
      const sign = m[1 + i * 4] === "-" ? -1 : 1;
      const lo = m[2 + i * 4];
      const hi = m[3 + i * 4];
      const single = m[4 + i * 4];
      // PoB writes negative ranges as "-(a-b)" meaning -a … -b (StatDescriber.lua)
      const range =
        single !== undefined
          ? { min: sign * Number(single), max: sign * Number(single) }
          : { min: sign * Number(lo), max: sign * Number(hi) };
      if (range.min > range.max) return undefined;
      const idx = cv.placeholders[i] as number;
      const prev = display[idx];
      if (prev && (prev.min !== range.min || prev.max !== range.max)) return undefined;
      display[idx] = range;
    }
    // invert handlers (applied in reverse order of PoB's application)
    const raw = display.map((d) => (d ? { ...d } : undefined));
    let lossy = false;
    for (const h of [...cv.variant.handlers].reverse()) {
      const inv = INVERSE[h.k];
      if (typeof h.v !== "number") continue;
      const target = raw[h.v - 1];
      if (inv === "noop" || inv === undefined || !target) continue;
      const a = round(inv(target.min));
      const b = round(inv(target.max));
      const forward = ROUNDING[h.k];
      if (forward) {
        // exact only if exactly one whole raw value renders to the shown value
        const checks: [number, number][] = [
          [target.min, a],
          [target.max, b],
        ];
        for (const [shown, est] of checks) {
          const r = Math.round(est);
          if (
            !near(forward(r), shown) ||
            near(forward(r - 1), shown) ||
            near(forward(r + 1), shown)
          )
            lossy = true;
        }
      }
      target.min = Math.min(a, b);
      target.max = Math.max(a, b);
    }
    const stats: StatValue[] = [];
    const rawMin: number[] = [];
    for (let i = 0; i < statCount; i++) {
      const limit = cv.variant.limit[i] ?? ["#", "#"];
      const v = raw[i];
      const statId = cv.description.stats[i] as string;
      if (v) {
        // PoB picks the variant by the stat's min value
        if (!within(limit, v.min)) return undefined;
        stats.push({ statId, min: v.min, max: v.max });
        rawMin.push(v.min);
      } else if (within(limit, 0)) {
        rawMin.push(0); // not shown and 0 allowed: the stat is absent on this mod
      } else if (typeof limit[0] === "number" && limit[0] === limit[1]) {
        stats.push({ statId, min: limit[0], max: limit[0] });
        rawMin.push(limit[0]);
      } else {
        return undefined; // value of a hidden stat cannot be determined
      }
    }
    // PoB renders with the FIRST variant whose limits fit; a later variant
    // matching the text is not what PoB would have produced
    for (const earlier of cv.description.variants.slice(0, cv.variantIndex)) {
      if (earlier.gemQuality) continue;
      if (rawMin.every((v, i) => within(earlier.limit[i] ?? ["#", "#"], v))) return undefined;
    }
    // raw stat values in PoB's mod data are whole numbers; a fraction means the display was rounded
    if (lossy || stats.some((st) => !Number.isInteger(st.min) || !Number.isInteger(st.max)))
      return "lossy";
    // PoB only renders a description if some stat is non-zero; if none is
    // determined, the value is hidden in the text and must not count as known
    if (!stats.some((st) => st.min !== 0 || st.max !== 0)) return "hidden";
    for (const st of stats) {
      if (st.min > st.max)
        throw new Error(`internal: ${cv.descriptionId} produced min > max for ${st.statId}`);
    }
    return stats;
  }

  /**
   * Maps the display lines of one mod. Some descriptions render to several
   * lines, so when a line does not match alone it is retried joined with the
   * following lines (up to maxJoin).
   */
  matchLines(lines: readonly string[], scope: string, maxJoin = 3): MatchResult[] {
    return this.matchLineGroups(lines, scope, maxJoin).map((g) => g.result);
  }

  /** Like matchLines, but also returns which input lines each result covers. */
  matchLineGroups(
    lines: readonly string[],
    scope: string,
    maxJoin = 3,
  ): { result: MatchResult; lines: string[] }[] {
    const groups: { result: MatchResult; lines: string[] }[] = [];
    let i = 0;
    while (i < lines.length) {
      let res = this.match(lines[i] as string, scope);
      let used = 1;
      if (res.status === "unmatched") {
        for (let n = 2; n <= maxJoin && i + n <= lines.length; n++) {
          const joined = this.match(lines.slice(i, i + n).join("\n"), scope);
          if (joined.status !== "unmatched") {
            res = joined;
            used = n;
            break;
          }
        }
      }
      groups.push({ result: res, lines: lines.slice(i, i + used) });
      i += used;
    }
    return groups;
  }

  /**
   * Maps lines whose description is known by PoB's trade hash (mods carry
   * `tradeHashes: { [hash]: lines }`). Only descriptions inside the scope
   * chain count; nearer scopes win.
   */
  matchByHash(hash: number, lines: readonly string[], scope: string): MatchResult {
    const text = lines.join("\n");
    const chain = this.scopeChain(scope);
    const candidates = (this.byHash.get(hash) ?? []).filter((cv) =>
      chain.includes(cv.description.scope),
    );
    candidates.sort(
      (a, b) => chain.indexOf(a.description.scope) - chain.indexOf(b.description.scope),
    );
    let lossy: string | undefined;
    let hidden: CompiledVariant | undefined;
    for (const cv of candidates) {
      const stats = this.tryVariant(cv, text);
      if (stats === "lossy") lossy ??= cv.descriptionId;
      else if (stats === "hidden") hidden ??= cv;
      else if (stats) return { status: "matched", descriptionId: cv.descriptionId, stats };
    }
    if (lossy) return { status: "lossy", line: text, descriptionId: lossy };
    if (hidden) return hiddenResult(text, hidden);
    return { status: "unmatched", line: text };
  }

  /** Maps one display line within a scope chain; first matching scope wins. */
  match(line: string, scope: string): MatchResult {
    for (const s of this.scopeChain(scope)) {
      const hits = new Map<string, StatValue[]>();
      let lossy: string | undefined;
      const hidden: CompiledVariant[] = [];
      for (const cv of this.index.get(s)?.get(shapeKey(line)) ?? []) {
        if (hits.has(cv.descriptionId)) continue;
        const stats = this.tryVariant(cv, line);
        if (stats === "lossy") lossy ??= cv.descriptionId;
        else if (stats === "hidden") hidden.push(cv);
        else if (stats) hits.set(cv.descriptionId, stats);
      }
      if (hits.size === 0 && lossy) return { status: "lossy", line, descriptionId: lossy };
      if (hits.size === 0 && hidden.length > 0) {
        const ids = [...new Set(hidden.map((h) => h.descriptionId))].sort();
        if (ids.length > 1) return { status: "ambiguous", line, descriptionIds: ids };
        return hiddenResult(line, hidden[0] as CompiledVariant);
      }
      if (hits.size === 1) {
        const [[descriptionId, stats]] = [...hits] as [[string, StatValue[]]];
        return { status: "matched", descriptionId, stats };
      }
      if (hits.size > 1) {
        const distinct = new Set([...hits.values()].map((v) => JSON.stringify(v)));
        if (distinct.size === 1) {
          const [[descriptionId, stats]] = [...hits] as [[string, StatValue[]]];
          return { status: "matched", descriptionId, stats };
        }
        const descriptionIds = [...hits.keys()].sort();
        return {
          status: "ambiguous",
          line,
          descriptionIds,
          candidates: descriptionIds.map((descriptionId) => ({
            descriptionId,
            stats: hits.get(descriptionId) as StatValue[],
          })),
        };
      }
    }
    return { status: "unmatched", line };
  }
}
