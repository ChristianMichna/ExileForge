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

  it("reads the league list", async () => {
    const { client } = setup(() => json([{ id: "Now", name: "Now" }]));
    expect(await client.leagues()).toEqual([{ id: "Now", name: "Now" }]);
  });
});
