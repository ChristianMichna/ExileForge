import { readFile } from "node:fs/promises";
import { z } from "zod";
import { CalcProfileId } from "@astrolabe/contracts/common";

/**
 * Claude Desktop cancels MCP calls after about 60 s; a long-poll must end well
 * before that (see apps/server/README.md, "Lange Schleifen").
 */
export const MAX_LONG_POLL_SECONDS = 45;

/** Settings of the proof-of-concept pipeline (config/forge/forge.json → pipelines.poc). */
export const PocPipelineConfig = z.object({
  candidateCount: z.int().positive(),
  skeletonLevel: z.int().positive(),
  skeletonGemLevel: z.int().positive(),
  calcProfiles: z.array(CalcProfileId).min(1),
  promptVersion: z.string().min(1),
});
export type PocPipelineConfig = z.infer<typeof PocPipelineConfig>;

/** Versioned settings of the forge loop; lives in config/forge/forge.json. */
export const ForgeConfig = z.object({
  version: z.string().min(1),
  sessionCodeTtlMinutes: z.int().positive(),
  maxAttemptsPerTask: z.int().positive(),
  /** How long forge.next blocks while the run waits for the user. */
  waitLongPollSeconds: z.int().nonnegative().max(MAX_LONG_POLL_SECONDS),
  waitRetryAfterSeconds: z.int().positive(),
  /** Failed forge.attach calls allowed per minute before attach is refused (guessing guard). */
  attachFailuresPerMinute: z.int().positive(),
  pipelines: z.object({ poc: PocPipelineConfig }),
});
export type ForgeConfig = z.infer<typeof ForgeConfig>;

/** Reads and validates the forge config file. Throws with the file path as context. */
export async function loadForgeConfig(path: string): Promise<ForgeConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read forge config ${path}`, { cause: error });
  }
  const parsed = ForgeConfig.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid forge config ${path}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
