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
export type ExchangeOverviewResponse = z.infer<typeof ExchangeOverviewResponse>;
