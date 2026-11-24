import { z } from "zod";
import type { Json } from "../json.ts";
import type { MatchResult, StatMatcher, StatValue } from "./stat-matcher.ts";

/** The parts of a raw PoB mod this step reads. */
const rawModSchema = z
  .object({
    tradeHashes: z
      .record(z.string().regex(/^\d+$/), z.union([z.array(z.string()), z.object({}).strict()]))
      .optional(),
  })
  .loose();

export interface ModStatResult {
  modId: string;
  stats: StatValue[];
  /** lines whose stats could not be determined; kept visible, never dropped */
  unresolved: { lines: string[]; reason: "unmatched" | "ambiguous" | "no-trade-hash" }[];
}

export interface ModStatSummary {
  mods: number;
  modsFullyResolved: number;
  lineGroups: number;
  lineGroupsResolved: number;
}

/** Numbered display lines of a raw mod ("1", "2", …) in order. */
export function modLines(mod: Readonly<Record<string, Json>>): string[] {
  const lines: string[] = [];
  for (let i = 1; typeof mod[String(i)] === "string"; i++) lines.push(mod[String(i)] as string);
  return lines;
}

/**
 * Resolves the stats of every mod via its trade hashes (PoB's hash over the
 * stat ids of a description). Line groups without a usable hash fall back to
 * text matching; whatever stays open is listed per mod in `unresolved`.
 */
export function resolveModStats(
  mods: Readonly<Record<string, Json>>,
  matcher: StatMatcher,
  scope: string,
): { results: ModStatResult[]; summary: ModStatSummary } {
  const results: ModStatResult[] = [];
  const summary: ModStatSummary = {
    mods: 0,
    modsFullyResolved: 0,
    lineGroups: 0,
    lineGroupsResolved: 0,
  };
  for (const modId of Object.keys(mods).sort()) {
    const raw = mods[modId];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(`mod ${modId} is not an object`);
    }
    const parsed = rawModSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`mod ${modId}: ${z.prettifyError(parsed.error)}`);
    const result: ModStatResult = { modId, stats: [], unresolved: [] };
    const covered = new Set<string>();
    const record = (res: MatchResult, lines: string[], fallbackReason?: "no-trade-hash") => {
      summary.lineGroups++;
      if (res.status === "matched") {
        summary.lineGroupsResolved++;
        result.stats.push(...res.stats);
      } else {
        result.unresolved.push({
          lines,
          reason: fallbackReason && res.status === "unmatched" ? fallbackReason : res.status,
        });
      }
    };
    for (const hash of Object.keys(parsed.data.tradeHashes ?? {}).sort()) {
      const value = parsed.data.tradeHashes?.[hash];
      const lines = Array.isArray(value) ? value : [];
      lines.forEach((l) => covered.add(l));
      record(matcher.matchByHash(Number(hash), lines, scope), lines);
    }
    // lines not listed under any trade hash: text matching
    const rest = modLines(raw).filter((l) => !covered.has(l));
    if (rest.length > 0) {
      const matched = matcher.matchLines(rest, scope);
      for (const res of matched) {
        const lines = res.status === "matched" ? [] : [res.line];
        record(res, lines, "no-trade-hash");
      }
    }
    summary.mods++;
    if (result.unresolved.length === 0) summary.modsFullyResolved++;
    results.push(result);
  }
  return { results, summary };
}
