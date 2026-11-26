import { z } from "zod";
import { PatchStatus } from "@astrolabe/contracts/guide";
import { ApiError } from "./client";

/*
 * Check of the saved guides against the game data the app runs with
 * (server: GET /api/guides/patch-status). Not yet in the contracts package;
 * until it is there the page validates the answer itself.
 */

const Outcome = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), status: PatchStatus }),
  z.object({ kind: z.literal("error"), code: z.string().min(1), message: z.string() }),
]);

const GuideCheck = z.object({
  guideId: z.string().min(1),
  outcome: Outcome,
  checkedAt: z.string(),
});

const PatchCheckView = z.object({
  enabled: z.boolean(),
  releaseId: z.string().min(1),
  running: z.boolean(),
  error: z.string().optional(),
  guides: z.array(GuideCheck),
});
export type PatchCheckView = z.infer<typeof PatchCheckView>;
export type GuideCheck = z.infer<typeof GuideCheck>;

async function call(method: "GET" | "POST", url: string, signal?: AbortSignal) {
  const response = await fetch(url, { method, ...(signal ? { signal } : {}) });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new ApiError(`The server answered HTTP ${response.status}.`, response.status);
  }
  return PatchCheckView.parse(body);
}

export const loadPatchCheck = (signal?: AbortSignal) =>
  call("GET", "/api/guides/patch-status", signal);

export const refreshPatchCheck = (signal?: AbortSignal) =>
  call("POST", "/api/guides/patch-status/refresh", signal);
