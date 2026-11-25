import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createAppProtocolHandler } from "../src/main/app-protocol.js";
import { CONTENT_SECURITY_POLICY } from "../src/main/security.js";

let webRoot: string;
beforeAll(async () => {
  const parent = await mkdtemp(join(tmpdir(), "ef-desktop-"));
  webRoot = join(parent, "web");
  await mkdir(join(webRoot, "assets"), { recursive: true });
  await writeFile(join(webRoot, "index.html"), "<html>app</html>");
  await writeFile(join(webRoot, "assets", "a.js"), "console.log(1)");
  await writeFile(join(parent, "secret.txt"), "secret");
});

function handler(overrides: { fetch?: typeof fetch; ready?: boolean } = {}) {
  const upstream = vi.fn<typeof fetch>(
    async () => new Response('{"ok":true}', { headers: { "content-type": "application/json" } }),
  );
  const fetchFn = overrides.fetch ?? upstream;
  const ready = overrides.ready ?? true;
  return {
    upstream: fetchFn as ReturnType<typeof vi.fn<typeof fetch>>,
    handle: createAppProtocolHandler({
      webRoot,
      serverUrl: () => (ready ? "http://127.0.0.1:47615" : undefined),
      token: () => (ready ? "tok" : undefined),
      fetch: fetchFn,
    }),
  };
}
const req = (path: string, init?: RequestInit) => new Request(`astrolabe://app${path}`, init);

describe("static files", () => {
  it("serves index.html at / with CSP and nosniff", async () => {
    const res = await handler().handle(req("/"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>app</html>");
    expect(res.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("serves assets with their type", async () => {
    const res = await handler().handle(req("/assets/a.js"));
    expect(res.headers.get("content-type")).toContain("text/javascript");
  });

  it.each([
    "/../secret.txt",
    "/%2e%2e/secret.txt",
    "/assets/..%2f..%2fsecret.txt",
    "/a%5c..%5csecret.txt",
    "/%00",
  ])("refuses path %s", async (path) => {
    const res = await handler().handle(req(path));
    expect([400, 404]).toContain(res.status);
    expect(await res.text()).not.toContain("secret");
  });

  it("answers 404 for a missing file and for a folder", async () => {
    expect((await handler().handle(req("/nope.js"))).status).toBe(404);
    expect((await handler().handle(req("/assets"))).status).toBe(404);
  });
});

describe("api proxy", () => {
  it("adds the token and forwards only whitelisted headers", async () => {
    const { handle, upstream } = handler();
    const res = await handle(
      req("/api/runs?x=1", {
        method: "POST",
        body: '{"a":1}',
        headers: {
          "content-type": "application/json",
          cookie: "evil",
          authorization: "Bearer page",
        },
      }),
    );
    expect(res.status).toBe(200);
    const [url, init] = upstream.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:47615/api/runs?x=1");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer tok");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("does not forward the MCP endpoint or other paths", async () => {
    const { handle, upstream } = handler();
    expect((await handle(req("/mcp", { method: "POST", body: "{}" }))).status).toBe(405);
    expect((await handle(req("/mcp"))).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses methods other than GET and POST", async () => {
    const res = await handler().handle(req("/api/runs/x", { method: "DELETE" }));
    expect(res.status).toBe(405);
  });

  it("reports 503 while the server is not running", async () => {
    const res = await handler({ ready: false }).handle(req("/api/health"));
    expect(res.status).toBe(503);
  });

  it("reports 502 with the cause when the server cannot be reached", async () => {
    const res = await handler({
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    }).handle(req("/api/health"));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("ECONNREFUSED");
  });

  it("passes server errors through with their status", async () => {
    const res = await handler({
      fetch: async () => new Response('{"error":{"code":"unauthorized"}}', { status: 401 }),
    }).handle(req("/api/runs/x"));
    expect(res.status).toBe(401);
  });

  it("rejects a body over the limit", async () => {
    const res = await handler().handle(
      req("/api/runs", { method: "POST", body: "x".repeat(1_000_001) }),
    );
    expect(res.status).toBe(413);
  });
});
