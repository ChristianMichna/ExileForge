import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PriceBook } from "@astrolabe/contracts";
import {
  EconomyError,
  EconomyService,
  FileBookStore,
  FileHttpCache,
  parseEconomyConfig,
  parseItemMap,
  type BookStore,
} from "../src/index.js";
import { EconomyTools } from "@astrolabe/contracts";
import { catalogHas, config, itemMap, RELEASE, responseA, responseB } from "./fixtures.js";

class MemoryBooks implements BookStore {
  book: PriceBook | undefined;
  async get() {
    return this.book;
  }
  async latest() {
    return this.book;
  }
  async set(book: PriceBook) {
    this.book = book;
  }
}

function setup(
  over: {
    now?: Date;
    failing?: boolean;
    leagues?: { id: string; name: string }[];
    leaguesFail?: boolean;
    emptyResponses?: boolean;
    failStore?: boolean;
  } = {},
) {
  const books = new MemoryBooks();
  if (over.failStore) {
    books.set = async () => {
      throw new EconomyError("cache_error", "disk full");
    };
  }
  const requests: string[] = [];
  const client = {
    async leagues() {
      requests.push("leagues");
      if (over.leaguesFail) throw new EconomyError("network_error", "offline");
      return over.leagues ?? [{ id: "TestLeague", name: "TestLeague" }];
    },
    async exchangeOverview(league: string, type: string) {
      requests.push(`${league}/${type}`);
      if (over.failing) throw new EconomyError("network_error", "offline");
      if (over.emptyResponses) return { core: { primary: "prov-ref" }, lines: [] };
      return type === "TypeA" ? responseA : responseB;
    },
  };
  let now = over.now ?? new Date("2026-11-25T10:00:00Z");
  const service = new EconomyService({
    config,
    itemMap,
    client,
    books,
    dataReleaseId: RELEASE,
    catalogHas,
    now: () => now,
  });
  return {
    service,
    books,
    requests,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
    setFailing: (v: boolean) => (over.failing = v),
  };
}

describe("EconomyService", () => {
  it("fetches once, stores the book and serves the next call from the store", async () => {
    const { service, requests } = setup();
    const first = await service.getBook("TestLeague");
    expect(first.freshness).toBe("fresh");
    expect(requests).toEqual(["TestLeague/TypeA", "TestLeague/TypeB"]);
    await service.getBook("TestLeague");
    expect(requests).toHaveLength(2);
  });

  it("refreshes after the TTL", async () => {
    const { service, requests, advance } = setup();
    await service.getBook("TestLeague");
    advance(61 * 60_000);
    await service.getBook("TestLeague");
    expect(requests).toHaveLength(4);
  });

  it("returns the stored book as stale, with the error, when the refresh fails", async () => {
    const { service, advance, setFailing } = setup();
    const first = await service.getBook("TestLeague");
    advance(2 * 60 * 60_000);
    setFailing(true);
    const result = await service.getBook("TestLeague");
    expect(result.freshness).toBe("stale");
    expect(result.book).toEqual(first.book);
    expect(result.refreshError?.code).toBe("network_error");
  });

  it("throws, instead of returning an empty book, when there is no stored book and the fetch fails", async () => {
    const { service } = setup({ failing: true });
    await expect(service.getBook("TestLeague")).rejects.toMatchObject({ code: "network_error" });
  });

  it("uses the first league of the provider when none is given, and fails when there is none", async () => {
    const { service, requests } = setup({ leagues: [{ id: "Current", name: "Current" }] });
    const result = await service.getBook();
    expect(result.book.league).toBe("Current");
    expect(requests[0]).toBe("leagues");
    await expect(setup({ leagues: [] }).service.getBook()).rejects.toMatchObject({
      code: "no_league",
    });
  });

  it("answers economy.price with league, currency, freshness and one entry per item", async () => {
    const { service } = setup();
    const out = await service.price({ items: [{ kind: "baseItem", id: "cur-a" as never }] });
    expect(out).toMatchObject({
      league: "TestLeague",
      inCurrencyItemId: "cur-ref",
      freshness: "fresh",
    });
    expect(out.prices).toHaveLength(1);
  });
});

describe("EconomyService, failure handling", () => {
  it("shares one fetch between concurrent callers of the same league", async () => {
    const { service, requests } = setup();
    await Promise.all([
      service.getBook("TestLeague"),
      service.getBook("TestLeague"),
      service.getBook("TestLeague"),
    ]);
    expect(requests.filter((r) => r.startsWith("TestLeague/"))).toHaveLength(2);
  });

  it("refuses an implausible (empty) response and keeps the previous book", async () => {
    const good = setup();
    const first = await good.service.getBook("TestLeague");
    expect(first.freshness).toBe("fresh");
    const bad = setup({ emptyResponses: true });
    await expect(bad.service.getBook("TestLeague")).rejects.toMatchObject({
      code: "implausible_response",
    });
    const onlyUnmapped = {
      ...itemMap,
      items: { "prov-ref": itemMap.items["prov-ref"] as never },
    };
    const service = new EconomyService({
      config,
      itemMap: onlyUnmapped,
      client: {
        async leagues() {
          return [{ id: "TestLeague", name: "TestLeague" }];
        },
        async exchangeOverview() {
          return responseA;
        },
      },
      books: new MemoryBooks(),
      dataReleaseId: RELEASE,
      catalogHas,
    });
    await expect(service.getBook("TestLeague")).rejects.toMatchObject({
      code: "implausible_response",
    });
  });

  it("gives every concurrent caller the warnings of the shared fetch", async () => {
    const { service } = setup({ failStore: true });
    const results = await Promise.all([
      service.getBook("TestLeague"),
      service.getBook("TestLeague"),
    ]);
    for (const r of results) expect(r.warnings[0]?.code).toBe("cache_error");
  });

  it("returns a fresh book with a warning when it could not be stored", async () => {
    const { service } = setup({ failStore: true });
    const result = await service.getBook("TestLeague");
    expect(result.freshness).toBe("fresh");
    expect(result.warnings[0]?.code).toBe("cache_error");
  });

  it("falls back to the last stored league, as stale, when the league list is unavailable", async () => {
    const { service, books, requests } = setup({ leaguesFail: true });
    await expect(service.getBook()).rejects.toMatchObject({ code: "network_error" });
    await service.getBook("TestLeague");
    expect(books).toBeDefined();
    const result = await service.getBook();
    expect(result.freshness).toBe("stale");
    expect(result.book.league).toBe("TestLeague");
    expect(result.refreshError?.code).toBe("network_error");
    expect(requests.includes("leagues")).toBe(true);
  });

  it("price() output matches the contract and carries freshness, fetch time and the reason when stale", async () => {
    const { service, advance, setFailing } = setup();
    const out = EconomyTools["economy.price"].output;
    const fresh = await service.price({
      league: "TestLeague",
      items: [{ kind: "baseItem", id: "cur-a" as never }],
    });
    expect(out.safeParse(fresh).success).toBe(true);
    advance(3 * 60 * 60_000);
    setFailing(true);
    const stale = await service.price({
      league: "TestLeague",
      items: [{ kind: "baseItem", id: "cur-a" as never }],
    });
    expect(out.safeParse(stale).success).toBe(true);
    expect(stale).toMatchObject({ freshness: "stale", refreshError: { code: "network_error" } });
    expect(stale.fetchedAt).toBe(fresh.fetchedAt);
  });
});

describe("file stores", () => {
  it("round-trips a book and an http entry, and reports a corrupt file instead of hiding it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "economy-test-"));
    const warnings: string[] = [];
    const books = new FileBookStore(dir, (m) => warnings.push(m));
    const http = new FileHttpCache(dir, (m) => warnings.push(m));
    const { service } = setup();
    const { book } = await service.getBook("TestLeague");
    await books.set(book);
    expect(await books.get("TestLeague", RELEASE)).toEqual(book);
    expect(await books.get("OtherLeague", RELEASE)).toBeUndefined();
    expect((await books.latest(RELEASE))?.league).toBe("TestLeague");

    await http.set("https://x.test/a", { body: "{}", storedAt: "2026-11-25T00:00:00.000Z" });
    expect((await http.get("https://x.test/a"))?.body).toBe("{}");

    const file = (await readdir(dir)).find((f) => f.startsWith("book-"));
    if (!file) throw new Error("book file missing");
    await writeFile(join(dir, file), "{not json", "utf8");
    expect(await books.get("TestLeague", RELEASE)).toBeUndefined();
    expect(warnings.some((w) => w.includes("unreadable"))).toBe(true);
  });
});

describe("shipped config", () => {
  const read = (path: string) =>
    JSON.parse(readFileSync(new URL(`../../../config/economy/${path}`, import.meta.url), "utf8"));
  it("economy.json and item-map.json are valid", () => {
    const parsed = parseEconomyConfig(read("economy.json"));
    expect(parsed.baseUrl.startsWith("https://")).toBe(true);
    expect(parsed.userAgent).toContain("{appVersion}");
    expect(parsed.userAgent).toContain("{appName}");
    expect(() => parseItemMap(read("item-map.json"))).not.toThrow();
  });
});
