import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PobSources } from "../config.ts";
import { EXTRACT_LUA, extractRaw, type PobInstall } from "../pob/extract.ts";
import { releaseId, sha256, writeManifest, type SnapshotManifest } from "./snapshot.ts";

export interface BuildSnapshotOptions {
  pob: PobInstall;
  sources: PobSources;
  sourcesPath: string;
  outDir: string;
  gameVersion: string;
  revision: number;
  now?: Date;
}

/** Extracts all kinds from PoB into outDir/raw and writes outDir/manifest.json. */
export async function buildSnapshot(opts: BuildSnapshotOptions): Promise<SnapshotManifest> {
  const id = releaseId(opts.gameVersion, opts.revision);
  const out = resolve(opts.outDir);
  const rawDir = join(out, "raw");
  const meta = await extractRaw(opts.pob, opts.sources, rawDir);
  if (!meta.treeVersion) throw new Error("extractor reported no passive tree version");

  const shards: SnapshotManifest["shards"] = [];
  for (const k of opts.sources.kinds) {
    const path = `raw/${k.kind}.json`;
    const count = meta.kinds[k.kind];
    if (count === undefined) throw new Error(`extractor did not report kind ${k.kind}`);
    shards.push({ kind: k.kind, path, sha256: sha256(await readFile(join(out, path))), count });
  }

  const manifest: SnapshotManifest = {
    format: "astrolabe-raw-snapshot/1",
    releaseId: id,
    gameVersion: opts.gameVersion,
    pobVersion: meta.pobVersion,
    treeVersion: meta.treeVersion,
    createdAt: (opts.now ?? new Date()).toISOString(),
    sourceHashes: {
      "pob-sources.json": sha256(await readFile(opts.sourcesPath)),
      "extract.lua": sha256(await readFile(EXTRACT_LUA)),
    },
    shards,
  };
  await writeManifest(out, manifest);
  return manifest;
}
