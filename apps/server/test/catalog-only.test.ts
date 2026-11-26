import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createMemoryLogger } from "../src/logger.js";
import { startServer, type PobPool } from "../src/start.js";
import { REQUEST } from "./fixtures.js";
import { options as baseOptions } from "./start-options.js";

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

async function health(started: Awaited<ReturnType<typeof startServer>>) {
  const response = await started.app.inject({
    method: "GET",
    url: "/api/health",
    headers: { host: new URL(started.url).host },
  });
  return response.json<Record<string, unknown>>();
}

describe("catalog-only mode", () => {
  it("starts with --calc none, says so in /api/health and refuses runs", async () => {
    const opts = { ...baseOptions(), calc: "none" as const };
    const started = await startServer(opts);
    const { app } = started;
    const body = await health(started);
    expect(body).toMatchObject({ ok: true, calcEngine: "none", catalogOnly: true });
    expect(String(body.catalogOnlyReason)).toContain("v9.9.9");

    const token = readFileSync(opts.tokenFile, "utf8").trim();
    const created = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers: { authorization: `Bearer ${token}`, host: new URL(started.url).host },
      payload: { request: REQUEST },
    });
    expect(created.statusCode).toBe(409);
    expect(created.json()).toMatchObject({ error: { code: "calc_unavailable" } });
    await app.close();
  });

  it("drops to catalog only when PoB does not fit the data release, and closes the pool", async () => {
    const pool = fakePool();
    const opts = {
      ...baseOptions(),
      calc: {
        engine: "pob" as const,
        pool,
        optimizerConfigPath: "unused.json",
        pobVersion: "v1.0.0",
      },
      logger: createMemoryLogger(),
    };
    const started = await startServer(opts);
    const { app } = started;
    const body = await health(started);
    expect(body).toMatchObject({ calcEngine: "none", catalogOnly: true });
    expect(String(body.catalogOnlyReason)).toContain("v1.0.0");
    await app.close();
    expect(pool.closed).toBe(1);
  });
});
