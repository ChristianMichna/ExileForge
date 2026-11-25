import { z } from "zod";

/*
 * Shapes of the provider's economy responses as documented at
 * https://poe.ninja/docs/api. Only the fields we use are required; unknown
 * fields are ignored so the provider can add fields. A response that does not
 * match is an error, never a partial price list.
 */

export const LeaguesResponse = z.array(z.object({ id: z.string().min(1), name: z.string() }));

export const ExchangeOverviewResponse = z.object({
  core: z.object({ primary: z.string().min(1) }),
  lines: z.array(
    z.object({
      id: z.string().min(1),
      primaryValue: z.number(),
      volumePrimaryValue: z.number().nonnegative().optional(),
    }),
  ),
});
/** Unique item overview (stash endpoint). The line id may be a number or a string; it is kept as a string. */
export const UniqueOverviewResponse = z.object({
  /** Present in real responses; only `primary` is looked at, and only if it is there. */
  core: z.unknown().optional(),
  lines: z.array(
    z.object({
      id: z.union([z.string().min(1), z.number()]).transform(String),
      name: z.string().min(1),
      baseType: z.string().nullish(),
      variant: z.string().nullish(),
      corrupted: z.boolean().nullish(),
      primaryValue: z.number(),
      listingCount: z.number().nonnegative().nullish(),
    }),
  ),
});
export type UniqueOverviewResponse = z.infer<typeof UniqueOverviewResponse>;

export type ExchangeOverviewResponse = z.infer<typeof ExchangeOverviewResponse>;
