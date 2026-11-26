import { z } from "zod";
import { GuidePatchStatusView } from "@astrolabe/contracts/guide";
import { ApiError } from "./client";

/*
 * Check of the saved guides against the game data the app runs with
 * (server: GET /api/guides/patch-status, shape `GuidePatchStatusView` of the contracts).
 */

const ErrorBody = z.object({ error: z.object({ message: z.string() }) });

async function call(
  method: "GET" | "POST",
  url: string,
  signal?: AbortSignal,
): Promise<GuidePatchStatusView> {
  const response = await fetch(url, { method, ...(signal ? { signal } : {}) });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = ErrorBody.safeParse(body);
    throw new ApiError(
      parsed.success ? parsed.data.error.message : `The server answered HTTP ${response.status}.`,
      response.status,
    );
  }
  const view = GuidePatchStatusView.safeParse(body);
  if (!view.success) {
    throw new ApiError("The server sent an answer this app version does not understand.", 502, {
      cause: view.error,
    });
  }
  return view.data;
}

export const loadPatchCheck = (signal?: AbortSignal) =>
  call("GET", "/api/guides/patch-status", signal);

export const refreshPatchCheck = (signal?: AbortSignal) =>
  call("POST", "/api/guides/patch-status/refresh", signal);
