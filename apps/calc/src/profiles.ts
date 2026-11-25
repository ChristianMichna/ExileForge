import { CalcProfileId } from "@exileforge/contracts";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";

/**
 * A calc profile fixes the situation numbers are calculated for (enemy,
 * conditions, charges, buffs) as overrides of PoB's Config tab. Keys are
 * PoB's own config option names (Modules/ConfigOptions.lua); the worker
 * rejects unknown keys and values that do not fit the option's type.
 * An empty `config` means: exactly what the build has saved.
 */
export const CalcProfileFile = z
  .object({
    $comment: z.string().optional(),
    id: CalcProfileId,
    description: z.string().min(1),
    config: z.array(
      z
        .object({
          key: z.string().min(1),
          value: z.union([z.boolean(), z.number(), z.string()]),
        })
        .strict(),
    ),
  })
  .strict();
export type CalcProfileFile = z.infer<typeof CalcProfileFile>;

export interface CalcProfile {
  readonly id: CalcProfileId;
  readonly description: string;
  readonly config: CalcProfileFile["config"];
  /** SHA-256 over id and config; part of every calcId. */
  readonly hash: string;
}

function profileHash(p: CalcProfileFile): string {
  return createHash("sha256")
    .update(JSON.stringify({ id: p.id, config: p.config }))
    .digest("hex");
}

/** Reads and validates every `<id>.json` in dir. */
export async function loadCalcProfiles(dir: string): Promise<ReadonlyMap<string, CalcProfile>> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  } catch (cause) {
    throw new Error(`cannot read calc profiles from ${dir}`, { cause });
  }
  if (names.length === 0) {
    throw new Error(`no calc profiles in ${dir}`);
  }
  const out = new Map<string, CalcProfile>();
  for (const name of names) {
    const path = join(dir, name);
    let parsed: CalcProfileFile;
    try {
      parsed = CalcProfileFile.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (cause) {
      throw new Error(`invalid calc profile ${path}`, { cause });
    }
    if (parsed.id !== basename(name, ".json")) {
      throw new Error(`calc profile ${path}: id ${parsed.id} does not match the file name`);
    }
    const keys = new Set<string>();
    for (const { key } of parsed.config) {
      if (keys.has(key)) throw new Error(`calc profile ${path}: option ${key} set twice`);
      keys.add(key);
    }
    out.set(parsed.id, {
      id: parsed.id,
      description: parsed.description,
      config: parsed.config,
      hash: profileHash(parsed),
    });
  }
  return out;
}
