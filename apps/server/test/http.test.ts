import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { RunEvent } from "@astrolabe/contracts/events";
import { CalcFake } from "../src/calc/calc-fake.js";
import { ForgeEngine } from "../src/engine/forge-engine.js";
import { createApp, LOOPBACK_HOST } from "../src/http/app.js";
import { createMemoryLogger } from "../src/logger.js";
import { createPocPipeline } from "../src/pipelines/poc-pipeline.js";
import { RunStore } from "../src/store/run-store.js";
import { CONFIG, REQUEST, RELEASE, candidate, fixtureCatalog } from "./fixtures.js";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, LOOPBACK_HOST, () => {
      const address = srv.address();
      srv.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

const parseText = (result: unknown): Record<string, unknown> => {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return JSON.parse(content[0]?.text ?? "null") as Record<string, unknown>;
};

describe("local HTTP server", () => {
  let app: FastifyInstance;
  let base: string;
  let client: Client;
  const ALLOWED_ORIGIN = "http://127.0.0.1:5173";
  const TOKEN = "a".repeat(64);
  const auth = { authorization: `Bearer ${TOKEN}` };

  beforeAll(async () => {
    const port = await freePort();
    const catalog = fixtureCatalog();
    const calc = new CalcFake({ dataReleaseId: RELEASE });
    const engine = new ForgeEngine({
      store: new RunStore(":memory:"),
      catalog,
      calc,
      config: CONFIG,
      pipelines: [createPocPipeline(CONFIG.pipelines.poc)],
      calcProfiles: ["default"],
    });
    app = createApp({
      engine,
      catalog,
      calc,
      calcProfiles: ["default"],
      waitLongPollSeconds: 0,
      logger: createMemoryLogger(),
      port,
      allowedOrigins: [ALLOWED_ORIGIN],
      defaultPipelineId: "poc",
      accessToken: TOKEN,
    });
    await app.listen({ host: LOOPBACK_HOST, port });
    base = `http://${LOOPBACK_HOST}:${port}`;
    client = new Client({ name: "test", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: auth } }),
    );
  });

  afterAll(async () => {
    await client.close();
    await app.close();
  });

  it("lists the forge, catalog and calc tools with Claude-compatible names and the start prompt", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "calc_evaluate",
      "catalog_get",
      "catalog_search",
      "forge_ask_user",
      "forge_attach",
      "forge_next",
      "forge_status",
      "forge_submit",
    ]);
    for (const name of names) expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["astrolabe"]);
    expect(client.getInstructions()).toContain("forge_attach");
  });

  it("drives a run: REST create → MCP attach/submit → REST events", async () => {
    const created = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ request: REQUEST }),
    });
    expect(created.status).toBe(201);
    const { runId, sessionCode } = (await created.json()) as { runId: string; sessionCode: string };

    const attached = parseText(
      await client.callTool({ name: "forge_attach", arguments: { code: sessionCode } }),
    );
    const step = attached["next"] as { kind: string; task: { taskId: string } };
    expect(step.kind).toBe("task");

    const rejected = await client.callTool({
      name: "forge_submit",
      arguments: { runId, taskId: step.task.taskId, attempt: 1, payload: { nope: true } },
    });
    expect(rejected.isError).toBeFalsy();
    expect(parseText(rejected)["result"]).toBe("rejected");

    const stale = await client.callTool({
      name: "forge_submit",
      arguments: { runId, taskId: step.task.taskId, attempt: 1, payload: {} },
    });
    expect(stale.isError).toBe(true);
    expect(parseText(stale)).toMatchObject({ error: { code: "stale_task" } });

    const accepted = await client.callTool({
      name: "forge_submit",
      arguments: {
        runId,
        taskId: step.task.taskId,
        attempt: 2,
        payload: candidate("a", "FixClassA", "FixAscA1"),
      },
    });
    expect(parseText(accepted)["result"]).toBe("accepted");

    const search = parseText(
      await client.callTool({
        name: "catalog_search",
        arguments: { text: "class b", kind: "characterClass" },
      }),
    );
    expect(search["results"]).toEqual([
      { kind: "characterClass", id: "FixClassB", name: "Fixture Class B" },
    ]);

    const calc = parseText(
      await client.callTool({
        name: "calc_evaluate",
        arguments: {
          state: {
            classId: "FixClassA",
            level: 1,
            tree: { allocated: [] },
            skills: [
              { key: "m", role: "main", gem: { gemId: "FixGemMain", level: 1 }, supports: [] },
            ],
            items: [],
          },
        },
      }),
    );
    expect(calc).toMatchObject({
      status: "calculated",
      results: [{ status: "ok", engine: "fake" }],
    });

    // SSE replay of everything so far.
    const controller = new AbortController();
    const res = await fetch(`${base}/api/runs/${runId}/events`, {
      signal: controller.signal,
      headers: auth,
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body?.getReader();
    let text = "";
    while (!text.includes("task.accepted") && reader) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    controller.abort();
    const events = text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => RunEvent.parse(JSON.parse(l.slice(6))));
    expect(events[0]).toMatchObject({ seq: 0, type: "run.phase" });
    expect(events.map((e) => e.type)).toContain("task.rejected");

    const view = await fetch(`${base}/api/runs/${runId}`, { headers: auth });
    expect(((await view.json()) as { results: object }).results).toHaveProperty(["S2.candidate-1"]);
  });

  it("refuses foreign origins and hosts (DNS rebinding / cross-site)", async () => {
    const port = new URL(base).port;
    const foreignOrigin = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: `127.0.0.1:${port}`, origin: "https://evil.example" },
    });
    expect(foreignOrigin.statusCode).toBe(403);
    const foreignHost = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: `evil.example:${port}` },
    });
    expect(foreignHost.statusCode).toBe(403);
    const ok = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: `localhost:${port}`, origin: ALLOWED_ORIGIN },
    });
    expect(ok.json()).toMatchObject({ ok: true, calcEngine: "fake" });
  });

  it("requires the access token everywhere except /api/health", async () => {
    const noToken = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: REQUEST }),
    });
    expect(noToken.status).toBe(401);
    const wrong = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer nope" },
      body: "{}",
    });
    expect(wrong.status).toBe(401);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });

  it("answers bad input with 400/404, not 500", async () => {
    const bad = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ request: { skillIdea: "x" } }),
    });
    expect(bad.status).toBe(400);
    const missing = await fetch(`${base}/api/runs/00000000-0000-4000-8000-000000000000`, {
      headers: auth,
    });
    expect(missing.status).toBe(404);
  });
});
