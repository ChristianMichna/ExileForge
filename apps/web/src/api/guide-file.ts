import { z } from "zod";
import { ApiError } from "./client";

/*
 * Guide files (server: POST /api/guides/import, GET /api/guides/:guideId/file). The file's
 * content is passed on as it is; the server checks it against the `GuideFile` contract and says
 * why it refuses a file.
 */

const ErrorBody = z.object({ error: z.object({ message: z.string() }) });
const ImportAnswer = z.object({ guideId: z.string().min(1) });

async function failure(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = ErrorBody.safeParse(body);
  return new ApiError(
    parsed.success ? parsed.data.error.message : `The server answered HTTP ${response.status}.`,
    response.status,
  );
}

/** Hands a guide file's text to the server; resolves with the id of the stored guide. */
export async function importGuideFile(text: string, signal?: AbortSignal): Promise<string> {
  try {
    JSON.parse(text);
  } catch (cause) {
    throw new ApiError("This file is not valid JSON, so it is not an Astrolabe guide file.", 400, {
      cause,
    });
  }
  const response = await fetch("/api/guides/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: text,
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await failure(response);
  const answer = ImportAnswer.safeParse(await response.json().catch(() => undefined));
  if (!answer.success) {
    throw new ApiError("The server sent an answer this app version does not understand.", 502, {
      cause: answer.error,
    });
  }
  return answer.data.guideId;
}

/** The guide as a file: the JSON text the server wrote. */
export async function loadGuideFileText(guideId: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`/api/guides/${encodeURIComponent(guideId)}/file`, {
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await failure(response);
  return response.text();
}
