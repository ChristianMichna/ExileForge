import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CalcServiceError } from "./errors.ts";
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

/** Message with the calc error kind and the cause chain, for the report. */
function describe(err: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = err; e !== undefined && parts.length < 5;) {
    if (e instanceof CalcServiceError) parts.push(`[${e.kind}] ${e.message}`);
    else if (e instanceof Error) parts.push(e.message);
    else parts.push(String(e));
    e = e instanceof Error ? e.cause : undefined;
  }
  return parts.join(" <- ");
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
  const unknown = (only ?? []).filter((id) => !manifest.builds.some((b) => b.id === id));
  if (unknown.length) throw new Error(`golden builds not in the manifest: ${unknown.join(", ")}`);
  const builds = manifest.builds.filter((b) => !only || only.includes(b.id));
  if (builds.length === 0) throw new Error(`no golden builds in ${dir}`);
  return Promise.all(
    builds.map(async ({ id }): Promise<GoldenOutcome> => {
      const expectedPath = join(dir, "expected", `${id}.json`);
      const buildPath = join(dir, "builds", `${id}.xml`);
      // Only "not recorded yet" is a soft outcome; unreadable or invalid files are errors.
      if (!existsSync(expectedPath) || !existsSync(buildPath)) {
        return {
          id,
          status: "missing",
          detail: "build or expected values not recorded",
          diffs: [],
        };
      }
      let expected: z.infer<typeof Expected>;
      let xml: string;
      try {
        expected = Expected.parse(await readJson(expectedPath));
        xml = await readFile(buildPath, "utf8");
      } catch (err) {
        return { id, status: "error", detail: describe(err), diffs: [] };
      }
      const started = Date.now();
      try {
        const { handle } = await pool.request("build.load", { format: "xml", payload: xml });
        let result;
        try {
          result = await pool.request("calc.stats", { handle, profile: "as-saved" });
        } finally {
          await pool.request("build.release", { handle });
        }
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
          detail: describe(err),
          diffs: [],
        };
      }
    }),
  );
}
