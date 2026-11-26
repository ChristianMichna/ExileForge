import { describe, expect, it } from "vitest";
import { CalcFake } from "../src/calc/calc-fake.js";
import { PersistedCalc } from "../src/calc/persisted-calc.js";
import { ForgeEngine } from "../src/engine/forge-engine.js";
import { createApp } from "../src/http/app.js";
import { createMemoryLogger } from "../src/logger.js";
import { createPocPipeline } from "../src/pipelines/poc-pipeline.js";
import { RunStore } from "../src/store/run-store.js";
import { CONFIG, RELEASE, fixtureCatalog } from "./fixtures.js";

const TOKEN = "e".repeat(64);
const headers = { host: "127.0.0.1:1", authorization: `Bearer ${TOKEN}` };

function app() {
  const store = new RunStore(":memory:");
  const catalog = fixtureCatalog();
  const calc = new PersistedCalc(new CalcFake({ dataReleaseId: RELEASE }), store);
  return createApp({
    engine: new ForgeEngine({
      store,
      catalog,
      calc,
      config: CONFIG,
      pipelines: [createPocPipeline(CONFIG.pipelines.poc)],
      calcProfiles: ["default"],
    }),
    catalog,
    calc,
    calcProfiles: ["default"],
    waitLongPollSeconds: 0,
    logger: createMemoryLogger(),
    port: 1,
    allowedOrigins: [],
    defaultPipelineId: "poc",
    accessToken: TOKEN,
  });
}

const status = (a: ReturnType<typeof app>, auth = true) =>
  a.inject({
    method: "GET",
    url: "/api/claude/status",
    headers: auth ? headers : { host: headers.host },
  });

describe("GET /api/claude/status", () => {
  it("says null until an authorised client has called the MCP endpoint", async () => {
    const a = app();
    expect((await status(a)).json()).toEqual({ mcpLastCallAt: null });

    // Without the token the call is refused and must not count as a Claude connection.
    await a.inject({ method: "POST", url: "/mcp", headers: { host: headers.host }, payload: {} });
    expect((await status(a)).json()).toEqual({ mcpLastCallAt: null });

    // A call the transport refuses (unreadable body) is not a Claude connection either.
    const refused = await a.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...headers, accept: "application/json, text/event-stream" },
      payload: "not json",
    });
    expect(refused.statusCode).toBeGreaterThanOrEqual(400);
    expect((await status(a)).json()).toEqual({ mcpLastCallAt: null });

    const initialize = () =>
      a.inject({
        method: "POST",
        url: "/mcp",
        headers: { ...headers, accept: "application/json, text/event-stream" },
        payload: {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "t", version: "1" },
          },
        },
      });
    const first = await initialize();
    expect(first.statusCode).toBe(200);
    expect(
      (first.json() as { result: { protocolVersion: string } }).result.protocolVersion,
    ).toBeTruthy();
    const one = ((await status(a)).json() as { mcpLastCallAt: string }).mcpLastCallAt;
    expect(Number.isNaN(Date.parse(one))).toBe(false);
    await initialize();
    const two = ((await status(a)).json() as { mcpLastCallAt: string }).mcpLastCallAt;
    expect(Date.parse(two)).toBeGreaterThanOrEqual(Date.parse(one));
  });

  it("needs the access token", async () => {
    expect((await status(app(), false)).statusCode).toBe(401);
  });
});
