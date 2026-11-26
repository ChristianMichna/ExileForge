import { z } from "zod";
import { ApiError } from "./client";

/*
 * The finished guide as the game's `.build` file (server: GET /api/guides/:guideId/build-file).
 * The file's content is passed on as the server wrote it; the app only checks its outline.
 */

const ErrorBody = z.object({ error: z.object({ message: z.string() }) });
const BuildFileAnswer = z.object({
  file: z.looseObject({ name: z.string().min(1) }),
  omitted: z.array(z.string()),
});
export interface BuildFileExport {
  readonly name: string;
  /** The `.build` file's JSON text. */
  readonly content: string;
  /** What the release has no game id or name for, so the file lacks it. */
  readonly omitted: readonly string[];
}

export async function loadBuildFile(
  guideId: string,
  signal?: AbortSignal,
): Promise<BuildFileExport> {
  const response = await fetch(`/api/guides/${encodeURIComponent(guideId)}/build-file`, {
    ...(signal ? { signal } : {}),
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = ErrorBody.safeParse(body);
    throw new ApiError(
      parsed.success ? parsed.data.error.message : `The server answered HTTP ${response.status}.`,
      response.status,
    );
  }
  const answer = BuildFileAnswer.safeParse(body);
  if (!answer.success) {
    throw new ApiError("The server sent an answer this app version does not understand.", 502, {
      cause: answer.error,
    });
  }
  return {
    name: answer.data.file.name,
    content: JSON.stringify(answer.data.file, null, 2),
    omitted: answer.data.omitted,
  };
}
