import type { PriceBook } from "@exileforge/contracts";
import type { EconomyConfig, ItemMap } from "../src/index.js";
import type { ExchangeOverviewResponse } from "../src/provider.js";

/*
 * Invented provider ids, catalog ids and prices. They test the logic only;
 * the response shapes follow the provider's public docs, the values are made up.
 */

export const RELEASE = "poe2-0.0.1+r1" as PriceBook["dataReleaseId"];

export const config: EconomyConfig = {
  version: "test",
  provider: "test-provider",
  baseUrl: "https://prices.example.test",
  game: "gx",
  appName: "TestApp",
  userAgent: "{appName}/{appVersion} (contact: https://example.test/app)",
  paths: { leagues: "/{game}/api/leagues", exchangeOverview: "/{game}/api/exchange" },
  exchangeTypes: ["TypeA", "TypeB"],
  cacheTtlMinutes: 60,
  minRequestIntervalMs: 1000,
  requestTimeoutMs: 5000,
  rateLimitBackoffMs: 60_000,
  maxRateLimitBackoffMs: 3_600_000,
  minQuotes: 1,
  maxResponseBytes: 10_000,
  confidence: { high: 500, medium: 50 },
};

export const itemMap: ItemMap = {
  version: "test",
  items: {
    "prov-ref": { kind: "baseItem", id: "cur-ref" },
    "prov-a": { kind: "baseItem", id: "cur-a" },
    "prov-b": { kind: "baseItem", id: "cur-b" },
    "prov-unique": { kind: "uniqueItem", id: "uniq-x" },
    "prov-ghost": { kind: "baseItem", id: "not-in-catalog" },
  },
};

export const catalogHas = (kind: string, id: string) =>
  kind === "baseItem" ? ["cur-ref", "cur-a", "cur-b"].includes(id) : id === "uniq-x";

export const responseA: ExchangeOverviewResponse = {
  core: { primary: "prov-ref" },
  lines: [
    { id: "prov-a", primaryValue: 4, volumePrimaryValue: 900 },
    { id: "prov-b", primaryValue: 0.5, volumePrimaryValue: 60 },
    { id: "prov-unknown", primaryValue: 3, volumePrimaryValue: 10 },
  ],
};

export const responseB: ExchangeOverviewResponse = {
  core: { primary: "prov-ref" },
  lines: [
    { id: "prov-ghost", primaryValue: 7 },
    { id: "prov-unique", primaryValue: 0, volumePrimaryValue: 1 },
  ],
};
