import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createMemoryLogger } from "../src/logger.js";
import { startServer, type PobPool } from "../src/start.js";
import { writeFixtureRelease } from "./fixtures.js";

const root = join(import.meta.dirname, "../../..");

function fakePool(): PobPool & { closed: number } {
  const pool = {
    closed: 0,
    request: vi.fn(() => Promise.reject(new Error("not used"))),
    baseBuild: vi.fn(() => Promise.reject(new Error("not used"))),
    close: () => {
      pool.closed += 1;
      return Promise.resolve();
    },
  };
  return pool as unknown as PobPool & { closed: number };
}

function options(pool: PobPool, optimizerConfigPath: string) {
  const dir = mkdtempSync(join(tmpdir(), "astrolabe-start-"));
  return {
    port: 0,
    databasePath: join(dir, "db.sqlite"),
    catalogDir: writeFixtureRelease(),
    configPath: join(root, "config/forge/forge.json"),
    stagesConfigPath: join(root, "config/agents/stages.json"),
    calc: { engine: "pob" as const, pool, optimizerConfigPath },
    allowedOrigins: [],
    tokenFile: join(dir, "token"),
    logger: createMemoryLogger(),
  };
}

describe("startServer with the PoB engine", () => {
  it("uses the forge pipeline by default and closes the pool with the app", async () => {
    const pool = fakePool();
    const { app } = await startServer(options(pool, join(root, "config/optimizer/tree.json")));
    expect(pool.closed).toBe(0);
    await app.close();
    expect(pool.closed).toBe(1);
  });

  it("closes the pool when startup fails", async () => {
    const pool = fakePool();
    await expect(startServer(options(pool, join(root, "does-not-exist.json")))).rejects.toThrow();
    expect(pool.closed).toBe(1);
  });
});
