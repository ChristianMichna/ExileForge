import { z } from "zod";
import { GuideListView, GuideView } from "@astrolabe/contracts/guide";
import { ApiError } from "./client";

/*
 * Saved guides from the local server: the list (GET /api/guides, `GuideListView`) and one guide
 * with the names and results behind it (GET /api/guides/:id/view, `GuideView`). Both answers are
 * checked against the contracts.
 */

const ErrorBody = z.object({ error: z.object({ message: z.string() }) });

async function get<T>(
  url: string,
  schema: z.ZodType<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  const response = await fetch(url, signal ? { signal } : {});
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = ErrorBody.safeParse(body);
    throw new ApiError(
      parsed.success ? parsed.data.error.message : `The server answered HTTP ${response.status}.`,
      response.status,
    );
  }
  const answer = schema.safeParse(body);
  if (!answer.success) {
    throw new ApiError("The server sent an answer this app version does not understand.", 502, {
      cause: answer.error,
    });
  }
  return answer.data;
}

export const loadGuideList = (signal?: AbortSignal): Promise<GuideListView> =>
  get("/api/guides", GuideListView, signal);

export const loadGuideView = (guideId: string, signal?: AbortSignal): Promise<GuideView> =>
  get(`/api/guides/${encodeURIComponent(guideId)}/view`, GuideView, signal);
