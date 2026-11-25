import { z } from "zod";

const apiPath = z
  .string()
  .startsWith("/")
  .refine((p) => !p.startsWith("//") && !p.includes("\\"), "must stay on the configured host");

const confidenceVolume = z.object({
  high: z.number().nonnegative(),
  medium: z.number().nonnegative(),
});

/** config/economy/economy.json */
export const EconomyConfig = z
  .object({
    $comment: z.string().optional(),
    $commentUniques: z.string().optional(),
    $commentUserAgent: z.string().optional(),
    $commentConfidence: z.string().optional(),
    version: z.string().min(1),
    provider: z.string().min(1),
    baseUrl: z.url().refine((u) => u.startsWith("https://"), "must be https"),
    game: z.string().regex(/^[a-z0-9]+$/),
    /** Product name used for the {appName} placeholder; change it here when the app is renamed. */
    appName: z.string().min(1),
    userAgent: z.string().min(1),
    paths: z.object({
      leagues: apiPath,
      exchangeOverview: apiPath,
      /** Unique item prices; required when uniqueTypes is not empty. */
      uniqueOverview: apiPath.optional(),
    }),
    exchangeTypes: z.array(z.string().min(1)).min(1),
    /** Provider types of unique items to price; empty = no unique prices. */
    uniqueTypes: z.array(z.string().min(1)).default([]),
    cacheTtlMinutes: z.int().positive(),
    minRequestIntervalMs: z.int().nonnegative(),
    requestTimeoutMs: z.int().positive(),
    /** Pause after a 429 without a usable Retry-After. */
    rateLimitBackoffMs: z.int().positive(),
    /** Upper bound for a provider-given Retry-After. */
    maxRateLimitBackoffMs: z.int().positive(),
    /** A refresh with fewer usable quotes is refused and the old book kept. */
    minQuotes: z.int().positive(),
    maxResponseBytes: z.int().positive(),
    confidence: confidenceVolume,
    /** Thresholds on the number of listings of a unique item; required when uniqueTypes is not empty. */
    uniqueConfidence: confidenceVolume.optional(),
  })
  .refine((c) => c.uniqueTypes.length === 0 || c.paths.uniqueOverview !== undefined, {
    message: "paths.uniqueOverview is required when uniqueTypes is not empty",
    path: ["paths", "uniqueOverview"],
  })
  .refine((c) => c.uniqueTypes.length === 0 || c.uniqueConfidence !== undefined, {
    message: "uniqueConfidence is required when uniqueTypes is not empty",
    path: ["uniqueConfidence"],
  })
  .refine((c) => c.confidence.high >= c.confidence.medium, {
    message: "confidence.high must be >= confidence.medium",
    path: ["confidence"],
  });
export type EconomyConfig = z.infer<typeof EconomyConfig>;

/** config/economy/item-map.json: provider id -> catalog entity. */
export const ItemMap = z.object({
  $comment: z.string().optional(),
  version: z.string().min(1),
  items: z.record(
    z.string().min(1),
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("baseItem"), id: z.string().min(1) }),
      z.object({ kind: z.literal("uniqueItem"), id: z.string().min(1) }),
    ]),
  ),
});
export type ItemMap = z.infer<typeof ItemMap>;

export function parseEconomyConfig(raw: unknown): EconomyConfig {
  return EconomyConfig.parse(raw);
}

export function parseItemMap(raw: unknown): ItemMap {
  return ItemMap.parse(raw);
}
