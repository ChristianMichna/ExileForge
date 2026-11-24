import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CalcPool } from "./pool.ts";

/*
 * Golden builds (evals/golden, recorded by tools/golden_builds.py) checked
 * through the calc pool. Same rules as the Python check: a missing value only
 * matches a missing value, tolerances come from evals/golden/config.json.
 */

const GoldenConfig = z.object({
  compareStats: z.array(z.string().min(1)).min(1),
  tolerance: z.object({ relative: z.number().nonnegative(), absolute: z.number().nonnegative() }),
});
const Manifest = z.object({ builds: z.array(z.object({ id: z.string().min(1) })) });
const Expected = z.object({
  id: z.string(),
  pobVersion: z.string(),
  build: z.object({ mainSkill: z.string().optional() }).optional(),
  stats: z.record(z.string(), z.number().nullable()),
});

export interface Tolerance {
  relative: number;
  absolute: number;
}

export interface StatDiff {
  stat: string;
  expected: number | null;
  actual: number | null;
}

export type GoldenStatus = "ok" | "regression" | "missing" | "error" | "pob-changed";

export interface GoldenOutcome {
  id: string;
  status: GoldenStatus;
  detail?: string;
  diffs: StatDiff[];
  ms?: number;
}

export function sameValue(actual: number | null, expected: number | null, tol: Tolerance): boolean {
  if (actual === null || expected === null) return actual === null && expected === null;
  if (Number.isNaN(actual) || Number.isNaN(expected)) return false;
  return Math.abs(actual - expected) <= Math.max(tol.absolute, Math.abs(expected) * tol.relative);
}

export function compareStats(
  actual: Readonly<Record<string, number>>,
  expected: Readonly<Record<string, number | null>>,
  keys: readonly string[],
  tol: Tolerance,
): StatDiff[] {
  return keys
    .map((stat) => ({ stat, expected: expected[stat] ?? null, actual: actual[stat] ?? null }))
    .filter((d) => !sameValue(d.actual, d.expected, tol));
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (cause) {
    throw new Error(`cannot read ${path}`, { cause });
  }
}

/** Calculates every golden build with profile `as-saved` and compares with the recorded values. */
export async function checkGoldenBuilds(
  pool: CalcPool,
  root: string,
  only?: readonly string[],
): Promise<GoldenOutcome[]> {
  const dir = join(root, "evals", "golden");
  const config = GoldenConfig.parse(await readJson(join(dir, "config.json")));
  const manifest = Manifest.parse(await readJson(join(dir, "manifest.json")));
  const builds = manifest.builds.filter((b) => !only || only.includes(b.id));
  return Promise.all(
    builds.map(async ({ id }): Promise<GoldenOutcome> => {
      let expected: z.infer<typeof Expected>;
      let xml: string;
      try {
        expected = Expected.parse(await readJson(join(dir, "expected", `${id}.json`)));
        xml = await readFile(join(dir, "builds", `${id}.xml`), "utf8");
      } catch (err) {
        return { id, status: "missing", detail: String(err), diffs: [] };
      }
      const started = Date.now();
      try {
        const { handle } = await pool.request("build.load", { format: "xml", payload: xml });
        const result = await pool.request("calc.stats", { handle, profile: "as-saved" });
        await pool.request("build.release", { handle });
        const ms = Date.now() - started;
        if (result.pobVersion.replace(/^v/, "") !== expected.pobVersion.replace(/^v/, "")) {
          return {
            id,
            status: "pob-changed",
            detail: `recorded with PoB ${expected.pobVersion}, now ${result.pobVersion}`,
            diffs: [],
            ms,
          };
        }
        const diffs = compareStats(
          result.stats,
          expected.stats,
          config.compareStats,
          config.tolerance,
        );
        return { id, status: diffs.length ? "regression" : "ok", diffs, ms };
      } catch (err) {
        return {
          id,
          status: "error",
          detail: err instanceof Error ? err.message : String(err),
          diffs: [],
        };
      }
    }),
  );
}
