import { readFile } from "node:fs/promises";
import { availableParallelism, freemem } from "node:os";
import { z } from "zod";

/** Pool settings from config/calc/pool.json (see apps/calc/README.md). */
export const PoolConfig = z
  .object({
    $comment: z.string().optional(),
    /** Number of workers, or "auto" (CPU cores and free memory, capped by maxWorkers). */
    size: z.union([z.int().positive(), z.literal("auto")]),
    maxWorkers: z.int().positive(),
    /** Measured resident memory of one worker with a loaded build (for "auto"). */
    workerMemoryMb: z.int().positive(),
    startTimeoutMs: z.int().positive(),
    requestTimeoutMs: z.int().positive(),
    /** Replace a worker after this many requests (memory growth in long sessions). */
    recycleAfterRequests: z.int().positive(),
    /** Start attempts per worker slot in a row before the slot is given up. */
    maxStartFailures: z.int().positive(),
    restartBackoffMs: z.int().nonnegative(),
    /** Grace period for a worker to exit after stdin closes, then it is killed. */
    stopGraceMs: z.int().nonnegative(),
    /** LuaJIT collector settings (collectgarbage setpause/setstepmul): memory vs. speed. */
    luaGc: z.object({ pause: z.int().positive(), stepmul: z.int().positive() }).strict(),
  })
  .strict();
export type PoolConfig = z.infer<typeof PoolConfig>;

export async function loadPoolConfig(path: string): Promise<PoolConfig> {
  try {
    return PoolConfig.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (cause) {
    throw new Error(`invalid calc pool config ${path}`, { cause });
  }
}

/** Leaves one core for the app and keeps half of the free memory for everything else. */
export function autoPoolSize(
  cfg: Pick<PoolConfig, "maxWorkers" | "workerMemoryMb">,
  cores: number = availableParallelism(),
  freeBytes: number = freemem(),
): number {
  const byCpu = cores - 1;
  const byMemory = Math.floor(freeBytes / 2 / (cfg.workerMemoryMb * 1024 * 1024));
  return Math.max(1, Math.min(cfg.maxWorkers, byCpu, byMemory));
}

export function resolvePoolSize(cfg: PoolConfig): number {
  return cfg.size === "auto" ? autoPoolSize(cfg) : cfg.size;
}
