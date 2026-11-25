import { z } from "zod";
import type { BuildRequest } from "@astrolabe/contracts/build";

/*
 * Calls to the local server. In the desktop app `/api` is answered by the app
 * protocol, which adds the access token; the page never holds it.
 */

const CreatedRun = z.object({
  runId: z.string().min(1),
  sessionCode: z.string().min(1),
  expiresAt: z.iso.datetime(),
});
export type CreatedRun = z.infer<typeof CreatedRun>;

const ErrorBody = z.object({ error: z.object({ message: z.string() }) });

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function createRun(request: BuildRequest, signal?: AbortSignal): Promise<CreatedRun> {
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ request }),
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
  return CreatedRun.parse(body);
}
