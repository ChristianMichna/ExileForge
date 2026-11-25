import { z } from "zod";

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
    version: z.string().min(1),
    provider: z.string().min(1),
    baseUrl: z.url().refine((u) => u.startsWith("https://"), "must be https"),
    game: z.string().regex(/^[a-z0-9]+$/),
    userAgent: z.string().min(1),
    paths: z.object({
      leagues: z.string().startsWith("/"),
      exchangeOverview: z.string().startsWith("/"),
    }),
    exchangeTypes: z.array(z.string().min(1)).min(1),
    cacheTtlMinutes: z.int().positive(),
    minRequestIntervalMs: z.int().nonnegative(),
    requestTimeoutMs: z.int().positive(),
    maxResponseBytes: z.int().positive(),
    confidence: confidenceVolume,
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
