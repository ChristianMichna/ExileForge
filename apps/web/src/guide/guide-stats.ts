import { z } from "zod";
import raw from "../../../../config/web/guide-stats.json";

/** The engine numbers shown per stage (config/web/guide-stats.json), checked when the app starts. */
const GuideStatsConfig = z.object({
  calcProfiles: z.array(z.string().min(1)).min(1),
  stats: z
    .array(
      z.object({
        stat: z.string().min(1),
        label: z.string().min(1),
        emphasis: z.boolean().optional(),
        onlyWhenReported: z.boolean().optional(),
        hideWhenReported: z.string().min(1).optional(),
      }),
    )
    .min(1),
});

export const GUIDE_STATS = GuideStatsConfig.parse(raw);
