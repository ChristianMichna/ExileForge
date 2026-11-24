#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { checkGoldenBuilds } from "./golden.ts";
import { pobInstallFromHome, startCalcPool, type CalcPool } from "./index.ts";

const USAGE = `exileforge-calc <command>   (run from the repository root)

  stats <file.xml | build code | -> [--profile as-saved] [--main-skill NAME] [--json]
      Calculate one build with Path of Building and print the main stats.

  golden [--only ID]...
      Check evals/golden builds through the calc pool. Exit 1 on any finding.

  bench [--workers N] [--rounds N]
      Measure worker cold start, build.load, calc.stats and worker memory.

Common options: --root . (repo root with config/), --pob-home <root>/.pob
`;

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const MAIN_STATS = [
  "CombinedDPS",
  "TotalDPS",
  "TotalDot",
  "Life",
  "EnergyShield",
  "Mana",
  "Spirit",
  "FireResist",
  "ColdResist",
  "LightningResist",
  "ChaosResist",
] as const;

async function readInput(value: string): Promise<{ format: "xml" | "code"; payload: string }> {
  let text = value;
  if (value === "-") {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    text = Buffer.concat(chunks).toString("utf8");
  } else if (value.endsWith(".xml") || value.endsWith(".txt")) {
    text = await readFile(value, "utf8");
  }
  text = text.trim();
  return text.startsWith("<")
    ? { format: "xml", payload: text }
    : { format: "code", payload: text };
}

/** Resident memory of a process in MB (Linux /proc, Windows tasklist); undefined if unknown. */
async function rssMb(pid: number | undefined): Promise<number | undefined> {
  if (pid === undefined) return undefined;
  if (process.platform === "linux") {
    const status = await readFile(`/proc/${String(pid)}/status`, "utf8");
    const kb = /VmRSS:\s+(\d+)/.exec(status)?.[1];
    return kb ? Math.round(Number(kb) / 1024) : undefined;
  }
  if (process.platform === "win32") {
    const { stdout } = await promisify(execFile)("tasklist", [
      "/FI",
      `PID eq ${String(pid)}`,
      "/FO",
      "CSV",
      "/NH",
    ]);
    const kb = /"([\d.,\s]+) K"/.exec(stdout)?.[1]?.replace(/[^\d]/g, "");
    return kb ? Math.round(Number(kb) / 1024) : undefined;
  }
  return undefined;
}

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function withPool<T>(
  root: string,
  pobHome: string | undefined,
  size: number | undefined,
  fn: (pool: CalcPool) => Promise<T>,
): Promise<T> {
  const pool = await startCalcPool({
    root,
    install: pobInstallFromHome(pobHome ?? resolve(root, ".pob")),
    ...(size ? { size } : {}),
    onEvent: (e) => {
      if (e.type !== "worker-started") console.error(`[calc] ${JSON.stringify(e)}`);
    },
  });
  try {
    return await fn(pool);
  } finally {
    await pool.close();
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      root: { type: "string", default: "." },
      "pob-home": { type: "string" },
      profile: { type: "string", default: "as-saved" },
      "main-skill": { type: "string" },
      json: { type: "boolean", default: false },
      only: { type: "string", multiple: true },
      workers: { type: "string" },
      rounds: { type: "string", default: "5" },
    },
  });
  const root = resolve(values.root);
  const pobHome = values["pob-home"];

  if (command === "stats") {
    const input = positionals[0] ?? fail(USAGE);
    const build = await readInput(input);
    return withPool(root, pobHome, 1, async (pool) => {
      const { handle, warnings } = await pool.request("build.load", build);
      const res = await pool.request("calc.stats", {
        handle,
        profile: values.profile,
        ...(values["main-skill"] ? { mainSkill: values["main-skill"] } : {}),
      });
      if (values.json) {
        out(JSON.stringify({ loadWarnings: warnings, result: res }, null, 2));
        return 0;
      }
      out(`Path of Building ${res.pobVersion} | profile ${res.calcProfile} | ${res.calcId}`);
      out(`Main skill: ${res.mainSkill ?? "(none)"}`);
      for (const k of MAIN_STATS) {
        const v = res.stats[k];
        out(`  ${k.padEnd(16)} ${v === undefined ? "(not reported)" : v.toLocaleString("en-US")}`);
      }
      for (const w of res.warnings) out(`Warning: ${w}`);
      if (res.unsupportedMods.length) {
        out(`Lines Path of Building does not support (${String(res.unsupportedMods.length)}):`);
        for (const m of res.unsupportedMods) out(`  ${m}`);
      }
      return 0;
    });
  }

  if (command === "golden") {
    return withPool(
      root,
      pobHome,
      values.workers ? Number(values.workers) : undefined,
      async (pool) => {
        const outcomes = await checkGoldenBuilds(pool, root, values.only);
        out(
          `Golden builds via calc pool (PoB ${pool.meta.pobVersion}, ${String(pool.size)} workers)`,
        );
        for (const o of outcomes) {
          out(
            `  ${o.status.padEnd(11)} ${o.id}${o.ms !== undefined ? ` (${String(o.ms)} ms)` : ""}${o.detail ? `: ${o.detail}` : ""}`,
          );
          for (const d of o.diffs) {
            out(`      ${d.stat}: expected ${String(d.expected)}, got ${String(d.actual)}`);
          }
        }
        // Unrecorded builds are listed, not failed (same rule as tools/golden_builds.py).
        return outcomes.some((o) => o.status !== "ok" && o.status !== "missing") ? 1 : 0;
      },
    );
  }

  if (command === "bench") {
    const rounds = Number(values.rounds);
    const workers = values.workers ? Number(values.workers) : 1;
    const xml = await readFile(resolve(root, "evals/golden/builds/pobb-ljOBlCON5WGB.xml"), "utf8");
    const t0 = Date.now();
    return withPool(root, pobHome, workers, async (pool) => {
      out(
        `cold start (${String(workers)} worker(s) in parallel, incl. data hash): ${String(Date.now() - t0)} ms`,
      );
      const loadMs: number[] = [];
      const statsMs: number[] = [];
      const cachedMs: number[] = [];
      for (let i = 0; i < rounds; i++) {
        let t = Date.now();
        const { handle } = await pool.request("build.load", { format: "xml", payload: xml });
        loadMs.push(Date.now() - t);
        t = Date.now();
        await pool.request("calc.stats", { handle, profile: "as-saved" });
        statsMs.push(Date.now() - t);
        t = Date.now();
        await pool.request("calc.stats", { handle, profile: "as-saved" });
        cachedMs.push(Date.now() - t);
        await pool.request("build.release", { handle });
      }
      const median = (xs: number[]): number =>
        [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
      out(`build.load median ${String(median(loadMs))} ms  (${loadMs.join(", ")})`);
      out(`calc.stats (same worker, state already loaded) median ${String(median(statsMs))} ms`);
      out(`calc.stats repeated median ${String(median(cachedMs))} ms`);
      // parallel throughput: every worker loads + calculates
      const n = workers * rounds;
      const tp = Date.now();
      await Promise.all(
        Array.from({ length: n }, async () => {
          const { handle } = await pool.request("build.load", { format: "xml", payload: xml });
          await pool.request("calc.stats", { handle, profile: "as-saved" });
          await pool.request("build.release", { handle });
        }),
      );
      const tpMs = Date.now() - tp;
      out(
        `throughput: ${String(n)} x (load + stats) in ${String(tpMs)} ms = ${(n / (tpMs / 1000)).toFixed(2)} builds/s`,
      );
      for (const pid of pool.workerPids()) {
        out(`worker ${String(pid)} memory: ${String(await rssMb(pid))} MB`);
      }
      return 0;
    });
  }

  fail(USAGE);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
