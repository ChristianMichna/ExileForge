import { z } from "zod";
import { DataReleaseId, IsoDateTime } from "../common/version.js";

/**
 * One stored guide in the app's list (server: GET /api/guides). The names come from the
 * catalog the server runs with; they are absent when that catalog does not know the id
 * (typically a guide of an older release, `current: false`), never replaced by the id.
 */
export const GuideListItem = z.object({
  guideId: z.string().min(1),
  dataReleaseId: DataReleaseId,
  generatedAt: IsoDateTime,
  ascendancyId: z.string().min(1),
  ascendancyName: z.string().min(1).optional(),
  mainSkillId: z.string().min(1),
  mainSkillName: z.string().min(1).optional(),
  /** Built with the data release the server runs with. */
  current: z.boolean(),
});
export type GuideListItem = z.infer<typeof GuideListItem>;

/** A stored guide that could not be read; the list says so instead of leaving it out. */
export const GuideListError = z.object({
  guideId: z.string().min(1),
  error: z.string().min(1),
});
export type GuideListError = z.infer<typeof GuideListError>;

export const GuideListView = z.object({
  /** Newest first. */
  guides: z.array(z.union([GuideListItem, GuideListError])),
});
export type GuideListView = z.infer<typeof GuideListView>;
