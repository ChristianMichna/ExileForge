import { readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * config/data-pipeline/pob-sources.json: which PoB data modules make up which
 * raw kind. Kept as data so a new PoB data file is a config change, not code.
 */
const kindName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/, "kind must be an identifier");
const relativeLuaPath = z
  .string()
  .regex(/^[A-Za-z0-9_./*-]+\.lua$/, "must be a relative .lua path")
  .refine((p) => !p.split("/").includes(".."), "must not leave PoB's src/ directory");

const tag = z.record(z.string(), z.string()).optional();

const moduleSource = z.discriminatedUnion("loader", [
  z.object({ loader: z.enum(["return", "list"]), file: relativeLuaPath, tag }).strict(),
  z
    .object({
      loader: z.enum(["fill", "skills"]),
      glob: relativeLuaPath,
      exclude: z.array(relativeLuaPath).default([]),
      tag,
    })
    .strict(),
  z.object({ loader: z.literal("uniqueDB") }).strict(),
  z.object({ loader: z.literal("gemLevels") }).strict(),
  z.object({ loader: z.literal("statDescriptions"), file: relativeLuaPath }).strict(),
  z
    .object({
      loader: z.literal("tree"),
      treeVersion: z.union([z.literal("latest"), z.string().regex(/^\d+_\d+$/)]),
    })
    .strict(),
]);

export const pobSourcesSchema = z
  .object({
    $comment: z.string().optional(),
    kinds: z
      .array(
        z
          .object({
            kind: kindName,
            functions: z.literal("marker").optional(),
            sources: z.array(moduleSource).min(1),
          })
          .strict(),
      )
      .min(1)
      .refine(
        (kinds) => new Set(kinds.map((k) => k.kind)).size === kinds.length,
        "kind names must be unique",
      ),
  })
  .strict();

export type PobSources = z.infer<typeof pobSourcesSchema>;
export type ModuleSource = PobSources["kinds"][number]["sources"][number];

export async function loadPobSources(path: string): Promise<PobSources> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (cause) {
    throw new Error(`cannot read PoB source config ${path}`, { cause });
  }
  const parsed = pobSourcesSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`invalid PoB source config ${path}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
