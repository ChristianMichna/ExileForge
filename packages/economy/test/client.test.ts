import { describe, expect, it } from "vitest";
import { EconomyError, PoeNinjaClient, type HttpCache } from "../src/index.js";
import type { HttpCacheEntry } from "../src/cache.js";
import { config, responseA } from "./fixtures.js";

class MemoryHttpCache implements HttpCache {
  readonly entries = new Map<string, HttpCacheEntry>();
  async get(url: string) {
    return this.entries.get(url);
  }
  async set(url: string, entry: HttpCacheEntry) {
    this.entries.set(url, entry);
  }
}

interface Call {
  url: string;
  headers: Record<string, string>;
}

function setup(
  respond: (call: Call, n: number) => Response | Promise<Response>,
  over: Partial<typeof config> = {},
) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let time = 1_000_000;
  const http = new MemoryHttpCache();
  const fetchFake = (async (url: string, init: RequestInit) => {
    const call = { url, headers: init.headers as Record<string, string> };
    calls.push(call);
    return respond(call, calls.length);
  }) as unknown as typeof fetch;
  const client = new PoeNinjaClient({
    config: { ...config, ...over },
    appVersion: "9.9.9",
    http,
    fetch: fetchFake,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
    clock: () => time,
  });
  return { client, calls, sleeps, http };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

describe("PoeNinjaClient", () => {
  it("sends an identifying User-Agent without personal data and builds the URL from config", async () => {
    const { client, calls } = setup(() => json(responseA));
    await client.exchangeOverview("Test League", "TypeA");
    const call = calls[0];
    expect(call?.url).toBe(
      "https://prices.example.test/gx/api/exchange?league=Test+League&type=TypeA",
    );
    expect(call?.headers["User-Agent"]).toBe("TestApp/9.9.9 (contact: https://example.test/app)");
  });

  it("keeps the minimum interval between requests, also for concurrent callers", async () => {
    const { client, sleeps } = setup(() => json(responseA));
    await Promise.all([
      client.exchangeOverview("L", "TypeA"),
      client.exchangeOverview("L", "TypeB"),
      client.exchangeOverview("L", "TypeA"),
    ]);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it("revalidates with ETag and uses the stored body on 304", async () => {
    const { client, calls } = setup((_, n) =>
      n === 1
        ? json(responseA, { headers: { etag: '"v1"' } })
        : new Response(null, { status: 304 }),
    );
    const first = await client.exchangeOverview("L", "TypeA");
    const second = await client.exchangeOverview("L", "TypeA");
    expect(second).toEqual(first);
    expect(calls[1]?.headers["If-None-Match"]).toBe('"v1"');
  });

  it("reports HTTP errors, rate limiting and network errors with their code and cause", async () => {
    const codeOf = async (respond: Parameters<typeof setup>[0]) => {
      const { client } = setup(respond);
      try {
        await client.exchangeOverview("L", "TypeA");
      } catch (error) {
        expect(error).toBeInstanceOf(EconomyError);
        return (error as EconomyError).code;
      }
      return "no error";
    };
    expect(await codeOf(() => new Response("x", { status: 500 }))).toBe("http_error");
    expect(await codeOf(() => new Response("x", { status: 429 }))).toBe("rate_limited");
    expect(
      await codeOf(() => {
        throw new TypeError("fetch failed");
      }),
    ).toBe("network_error");
    expect(
      await codeOf(() => {
        throw Object.assign(new Error("t"), { name: "TimeoutError" });
      }),
    ).toBe("timeout");
  });

  it("rejects 304 without a stored copy, non-JSON, wrong shapes and oversized bodies", async () => {
    const codeOf = async (respond: Parameters<typeof setup>[0]) => {
      const { client } = setup(respond);
      try {
        await client.exchangeOverview("L", "TypeA");
      } catch (error) {
        return (error as EconomyError).code;
      }
      return "no error";
    };
    expect(await codeOf(() => new Response(null, { status: 304 }))).toBe("invalid_response");
    expect(await codeOf(() => new Response("<html>", { status: 200 }))).toBe("invalid_response");
    expect(await codeOf(() => json({ lines: [] }))).toBe("invalid_response");
    expect(
      await codeOf(() => json({ ...responseA, lines: [{ id: "x", primaryValue: "4" }] })),
    ).toBe("invalid_response");
    expect(await codeOf(() => new Response("x".repeat(20_000), { status: 200 }))).toBe(
      "response_too_large",
    );
  });

  it("does not follow redirects", async () => {
    const { client, calls } = setup(
      () =>
        new Response(null, { status: 302, headers: { location: "http://elsewhere.example/x" } }),
    );
    await expect(client.exchangeOverview("L", "TypeA")).rejects.toMatchObject({
      code: "http_error",
    });
    expect(calls).toHaveLength(1);
  });

  it("pauses after 429 (Retry-After or the configured backoff) instead of asking again", async () => {
    let time = 0;
    const calls: number[] = [];
    const client = new PoeNinjaClient({
      config,
      appVersion: "1",
      http: new MemoryHttpCache(),
      fetch: (async () => {
        calls.push(time);
        return new Response("slow down", { status: 429, headers: { "retry-after": "120" } });
      }) as unknown as typeof fetch,
      sleep: async (ms) => void (time += ms),
      clock: () => time,
    });
    await expect(client.exchangeOverview("L", "TypeA")).rejects.toMatchObject({
      code: "rate_limited",
    });
    await expect(client.exchangeOverview("L", "TypeB")).rejects.toMatchObject({
      code: "rate_limited",
    });
    expect(calls).toHaveLength(1);
    time += 121_000;
    await expect(client.exchangeOverview("L", "TypeB")).rejects.toMatchObject({
      code: "rate_limited",
    });
    expect(calls).toHaveLength(2);
  });

  it("caps a huge Retry-After at the configured maximum", async () => {
    let time = 0;
    let calls = 0;
    const client = new PoeNinjaClient({
      config,
      appVersion: "1",
      http: new MemoryHttpCache(),
      fetch: (async () => {
        calls++;
        return new Response("x", { status: 429, headers: { "retry-after": "99999999" } });
      }) as unknown as typeof fetch,
      sleep: async (ms) => void (time += ms),
      clock: () => time,
    });
    await expect(client.exchangeOverview("L", "TypeA")).rejects.toMatchObject({
      code: "rate_limited",
    });
    time += config.maxRateLimitBackoffMs + 1;
    await expect(client.exchangeOverview("L", "TypeA")).rejects.toMatchObject({
      code: "rate_limited",
    });
    expect(calls).toBe(2);
  });

  it("stops reading a body that grows past the limit without announcing a length", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(4000));
        if (pulled > 100) controller.close();
      },
    });
    const { client } = setup(() => new Response(stream, { status: 200 }));
    await expect(client.exchangeOverview("L", "TypeA")).rejects.toMatchObject({
      code: "response_too_large",
    });
    expect(pulled).toBeLessThan(10);
  });

  it("does not store an invalid response, so a bad body is not revalidated forever", async () => {
    const { client, http } = setup(() => json({ nope: true }, { headers: { etag: '"x"' } }));
    await expect(client.exchangeOverview("L", "TypeA")).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect(http.entries.size).toBe(0);
  });

  it("works without the HTTP cache when it fails, and says so", async () => {
    const warnings: string[] = [];
    const failing: HttpCache = {
      async get() {
        throw new Error("disk");
      },
      async set() {
        throw new Error("disk");
      },
    };
    const client = new PoeNinjaClient({
      config,
      appVersion: "1",
      http: failing,
      fetch: (async () => json(responseA)) as unknown as typeof fetch,
      sleep: async () => undefined,
      onWarn: (m) => warnings.push(m),
    });
    expect(await client.exchangeOverview("L", "TypeA")).toEqual(responseA);
    expect(warnings).toHaveLength(2);
  });

  it("reads the league list", async () => {
    const { client } = setup(() => json([{ id: "Now", name: "Now" }]));
    expect(await client.leagues()).toEqual([{ id: "Now", name: "Now" }]);
  });
});
