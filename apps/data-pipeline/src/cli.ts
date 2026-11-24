#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadPobSources } from "./config.ts";
import { diffSnapshots, summarizeDiff } from "./diff/snapshot-diff.ts";
import { pobInstallFromHome } from "./pob/extract.ts";
import { buildSnapshot } from "./snapshot/build.ts";

const USAGE = `exileforge-data <command>

  snapshot --game-version <x.y[.z.w]> --revision <n> --out <dir>
           [--pob-home .pob] [--sources config/data-pipeline/pob-sources.json]
      Extract the pinned PoB's game data into <dir>/raw and write <dir>/manifest.json.

  diff <fromDir> <toDir> [--out <dir>]
      Compare two snapshots; writes diff.json and diff.md to --out (default: <toDir>).
`;

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command === "snapshot") {
    const { values } = parseArgs({
      args: rest,
      options: {
        "game-version": { type: "string" },
        revision: { type: "string" },
        out: { type: "string" },
        "pob-home": { type: "string", default: ".pob" },
        sources: { type: "string", default: "config/data-pipeline/pob-sources.json" },
      },
      strict: true,
    });
    const gameVersion = values["game-version"] ?? fail("--game-version is required");
    const revisionText = values.revision ?? fail("--revision is required");
    const out = values.out ?? fail("--out is required");
    const revision = Number(revisionText);
    if (!Number.isInteger(revision) || revision < 0)
      fail(`--revision must be a whole number >= 0, got ${revisionText}`);
    const sourcesPath = resolve(values.sources);
    const manifest = await buildSnapshot({
      pob: pobInstallFromHome(values["pob-home"]),
      sources: await loadPobSources(sourcesPath),
      sourcesPath,
      outDir: out,
      gameVersion,
      revision,
    });
    console.warn(
      `snapshot ${manifest.releaseId} (PoB ${manifest.pobVersion}, tree ${manifest.treeVersion})`,
    );
    for (const s of manifest.shards) console.warn(`  ${s.kind}: ${String(s.count)}`);
    return;
  }
  if (command === "diff") {
    const { values, positionals } = parseArgs({
      args: rest,
      options: { out: { type: "string" } },
      allowPositionals: true,
      strict: true,
    });
    const [fromDir, toDir] = positionals;
    if (!fromDir || !toDir || positionals.length !== 2) fail(USAGE);
    const out = resolve(values.out ?? toDir);
    const diff = await diffSnapshots(fromDir, toDir);
    await mkdir(out, { recursive: true });
    await writeFile(join(out, "diff.json"), JSON.stringify(diff, null, 2) + "\n");
    const summary = summarizeDiff(diff);
    await writeFile(join(out, "diff.md"), summary);
    console.warn(summary);
    return;
  }
  fail(USAGE);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
