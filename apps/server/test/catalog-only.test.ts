import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { CalcNone, pobMismatch } from "../src/calc/calc-none.js";
import { PersistedCalc } from "../src/calc/persisted-calc.js";
import { CalcFake } from "../src/calc/calc-fake.js";
import { ForgeEngine } from "../src/engine/forge-engine.js";
import { createMemoryLogger } from "../src/logger.js";
import { createForgeMcpServer } from "../src/mcp/forge-mcp.js";
import { RunStore } from "../src/store/run-store.js";
import { startServer, type PobPool } from "../src/start.js";
import { CONFIG, REQUEST, RELEASE, fixtureCatalog } from "./fixtures.js";
import { join } from "node:path";
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

const root = join(import.meta.dirname, "../../..");

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

  it("uses the PoB engine when the version fits the data release", async () => {
    const pool = fakePool();
    const opts = {
      ...baseOptions(),
      calc: {
        engine: "pob" as const,
        pool,
        optimizerConfigPath: join(root, "config/optimizer/tree.json"),
        pobVersion: "v9.9.9",
      },
    };
    const started = await startServer(opts);
    const body = await health(started);
    expect(body).toMatchObject({ calcEngine: "pob" });
    expect(body).not.toHaveProperty("catalogOnly");
    await started.app.close();
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

describe("pobMismatch", () => {
  it("ignores the v prefix and compares the rest", () => {
    expect(pobMismatch("v1.2.3", "1.2.3")).toBe(false);
    expect(pobMismatch("1.2.3", "v1.2.3")).toBe(false);
    expect(pobMismatch("v1.2.3", "v1.2.4")).toBe(true);
    expect(pobMismatch("v1.2.3", undefined)).toBe(false);
  });
});

describe("catalog-only mode, engine level", () => {
  const state = {
    classId: "FixClassA",
    level: 1,
    tree: { allocated: [] },
    skills: [{ key: "m", role: "main", gem: { gemId: "FixGemMain", level: 1 }, supports: [] }],
    items: [],
  };

  it("answers calc_evaluate with calc_unavailable and keeps stored results readable", async () => {
    const store = new RunStore(":memory:");
    const fake = new CalcFake({ dataReleaseId: RELEASE });
    const earlier = await new PersistedCalc(fake, store).calculate({
      state: state as never,
      profiles: ["default"],
    });
    const first = earlier["default"];
    if (first?.status !== "ok") throw new Error("fixture calculation failed");
    const calc = new PersistedCalc(new CalcNone("Catalog only: test reason"), store);
    const catalog = fixtureCatalog();
    const server = createForgeMcpServer({
      engine: new ForgeEngine({
        store,
        catalog,
        calc,
        config: CONFIG,
        pipelines: [],
        calcProfiles: ["default"],
        catalogOnlyReason: "Catalog only: test reason",
      }),
      catalog,
      calc,
      calcProfiles: ["default"],
      waitLongPollSeconds: 0,
      logger: createMemoryLogger(),
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const result = await client.callTool({ name: "calc_evaluate", arguments: { state } });
    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0]?.text ?? "";
    expect(JSON.parse(text)).toMatchObject({ error: { code: "calc_unavailable" } });
    expect((await calc.getResult(first.calcId))?.calcId).toBe(first.calcId);
  });
});
