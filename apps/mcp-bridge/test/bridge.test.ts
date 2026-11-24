import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { APP_NOT_RUNNING, startBridge } from "../src/bridge.js";
import { DEFAULT_PORT, endpointFromEnv } from "../src/endpoint.js";
import { fetchWithToken } from "../src/token.js";

const silent = { error: () => undefined };

describe("stdio bridge", () => {
  it("forwards requests and answers unchanged in both directions", async () => {
    // Fake app behind the bridge.
    const app = new McpServer({ name: "fake-app", version: "0" });
    app.registerTool("echo", { inputSchema: z.object({ text: z.string() }) }, ({ text }) => ({
      content: [{ type: "text", text }],
    }));
    const [appSide, bridgeRemote] = InMemoryTransport.createLinkedPair();
    await app.connect(appSide);

    const [clientSide, bridgeLocal] = InMemoryTransport.createLinkedPair();
    await startBridge(bridgeLocal, bridgeRemote, silent);
    const client = new Client({ name: "claude", version: "0" });
    await client.connect(clientSide);

    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["echo"]);
    const result = await client.callTool({ name: "echo", arguments: { text: "hi" } });
    expect(result.content).toEqual([{ type: "text", text: "hi" }]);
    await client.close();
  });

  it("answers with a clear error instead of hanging when the app is not running", async () => {
    const [clientSide, bridgeLocal] = InMemoryTransport.createLinkedPair();
    // Port 9 (discard) on loopback is closed in test environments.
    const remote = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:9/mcp"));
    await startBridge(bridgeLocal, remote, silent);
    const client = new Client({ name: "claude", version: "0" });
    await expect(client.connect(clientSide)).rejects.toThrow(APP_NOT_RUNNING);
  });
});

describe("endpoint and token", () => {
  it("only ever targets 127.0.0.1 with a valid port", () => {
    expect(endpointFromEnv({}).href).toBe(`http://127.0.0.1:${DEFAULT_PORT}/mcp`);
    expect(endpointFromEnv({ EXILEFORGE_PORT: "50000" }).href).toBe("http://127.0.0.1:50000/mcp");
    expect(() => endpointFromEnv({ EXILEFORGE_PORT: "evil.example" })).toThrow(/port number/);
  });

  it("adds the access token from the token file to every request", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "ef-bridge-")), "access-token");
    writeFileSync(file, `${"b".repeat(64)}\n`);
    let seen: string | null = null;
    const fetcher = fetchWithToken(file, async (_url, init) => {
      seen = new Headers(init?.headers).get("authorization");
      return new Response("{}");
    });
    await fetcher("http://127.0.0.1:1/mcp", { headers: { accept: "application/json" } });
    expect(seen).toBe(`Bearer ${"b".repeat(64)}`);
  });

  it("fails loudly when the token file is missing (app never started)", async () => {
    const fetcher = fetchWithToken("/nonexistent/exileforge/token", async () => new Response("{}"));
    await expect(fetcher("http://127.0.0.1:1/mcp")).rejects.toThrow(/access token not found/);
  });
});
