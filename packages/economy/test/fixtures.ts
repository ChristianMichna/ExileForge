import type { PriceBook } from "@astrolabe/contracts";
import type { EconomyConfig, ItemMap } from "../src/index.js";
import type { ExchangeOverviewResponse, UniqueOverviewResponse } from "../src/provider.js";

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
  uniqueTypes: [],
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

/** Config with unique prices switched on. */
export const configWithUniques: EconomyConfig = {
  ...config,
  paths: { ...config.paths, uniqueOverview: "/{game}/api/uniques" },
  uniqueTypes: ["UniqueX"],
  uniqueConfidence: { high: 50, medium: 10 },
};

export const catalogHasWithUniques = (kind: string, id: string) =>
  kind === "uniqueItem" ? ["uniq-1", "uniq-2"].includes(id) : catalogHas(kind, id);

/** Invented catalog: names are unique except "Twin", which exists twice on different bases. */
export const resolveUnique = (name: string, baseType: string | undefined): string | undefined => {
  if (name === "Alpha Piece") return "uniq-1";
  if (name === "Beta Piece") return "uniq-2";
  if (name === "Twin") return baseType === "Base One" ? "uniq-1" : undefined;
  return undefined;
};

export const uniqueResponse: UniqueOverviewResponse = {
  lines: [
    { id: "100", name: "Alpha Piece", baseType: "Base One", primaryValue: 2, listingCount: 80 },
    { id: "101", name: "Beta Piece", baseType: "Base Two", primaryValue: 0.25, listingCount: 5 },
    { id: "102", name: "Beta Piece", baseType: "Base Two", variant: "v2", primaryValue: 9 },
    { id: "103", name: "Alpha Piece", baseType: "Base One", corrupted: true, primaryValue: 7 },
    { id: "104", name: "Unknown Piece", baseType: "Base One", primaryValue: 3 },
    { id: "105", name: "Twin", baseType: "Base Two", primaryValue: 1 },
    { id: "106", name: "Beta Piece", baseType: "Base Two", primaryValue: 0 },
  ],
};
