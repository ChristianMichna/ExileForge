import { readdir } from "node:fs/promises";
import { posix } from "node:path";
import { join } from "node:path";
import type { PobSources } from "../config.ts";

/** One resolved module the Lua extractor loads (see lua/extract.lua). */
export type JobSource =
  | { loader: "return" | "list" | "fill" | "skills"; file: string; tag?: Record<string, string> }
  | { loader: "uniqueDB" }
  | { loader: "gemLevels" }
  | { loader: "statDescriptions"; file: string }
  | { loader: "tree"; treeVersion: string };

export interface ExtractJob {
  outDir: string;
  kinds: { kind: string; functions?: "marker"; sources: JobSource[] }[];
}

/** Matches a single-segment `*` glob such as `Data/Bases/*.lua`. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

async function expandGlob(pobSrcDir: string, glob: string): Promise<string[]> {
  const dir = posix.dirname(glob);
  if (dir.includes("*")) {
    throw new Error(`glob ${glob}: wildcards are only allowed in the file name`);
  }
  let names: string[];
  try {
    names = await readdir(join(pobSrcDir, ...dir.split("/")));
  } catch (cause) {
    throw new Error(`glob ${glob}: cannot list ${dir} in ${pobSrcDir}`, { cause });
  }
  const re = globToRegExp(glob);
  return names
    .map((n) => posix.join(dir, n))
    .filter((p) => re.test(p))
    .sort();
}

/**
 * Turns the source config into the concrete job for the Lua extractor:
 * globs are expanded against the PoB checkout, sorted for determinism.
 * A glob that matches nothing is an error (a renamed PoB folder must not
 * silently produce an empty kind).
 */
export async function buildExtractJob(
  sources: PobSources,
  pobSrcDir: string,
  outDir: string,
): Promise<ExtractJob> {
  const kinds: ExtractJob["kinds"] = [];
  for (const k of sources.kinds) {
    const resolved: JobSource[] = [];
    for (const s of k.sources) {
      if (s.loader === "fill" || s.loader === "skills") {
        const files = (await expandGlob(pobSrcDir, s.glob)).filter((f) => !s.exclude.includes(f));
        if (files.length === 0) {
          throw new Error(`kind ${k.kind}: glob ${s.glob} matches no file`);
        }
        for (const file of files) {
          resolved.push(
            s.tag ? { loader: s.loader, file, tag: s.tag } : { loader: s.loader, file },
          );
        }
      } else if (s.loader === "return" || s.loader === "list") {
        resolved.push(
          s.tag
            ? { loader: s.loader, file: s.file, tag: s.tag }
            : { loader: s.loader, file: s.file },
        );
      } else if (s.loader === "statDescriptions") {
        resolved.push({ loader: s.loader, file: s.file });
      } else if (s.loader === "gemLevels") {
        resolved.push({ loader: s.loader });
      } else if (s.loader === "uniqueDB") {
        resolved.push({ loader: s.loader });
      } else if (s.loader === "tree") {
        resolved.push({ loader: s.loader, treeVersion: s.treeVersion });
      }
    }
    kinds.push(
      k.functions
        ? { kind: k.kind, functions: k.functions, sources: resolved }
        : { kind: k.kind, sources: resolved },
    );
  }
  return { outDir, kinds };
}
