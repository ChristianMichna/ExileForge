import { useEffect, useState } from "react";
import { z } from "zod";
import { ApiError } from "./client";

/*
 * Whether a Claude client has reached the local MCP endpoint since the server started
 * (server: GET /api/claude/status).
 */

const ErrorBody = z.object({ error: z.object({ message: z.string() }) });
const ClaudeStatus = z.object({ mcpLastCallAt: z.iso.datetime().nullable() });

export type McpReach =
  | { readonly kind: "checking" }
  | { readonly kind: "not_yet" }
  | { readonly kind: "reached"; readonly at: string }
  | { readonly kind: "error"; readonly message: string };

/** How often the page asks while it waits for Claude. */
export const MCP_POLL_MS = 3000;
/** A check that takes longer is reported as failed instead of hanging for good. */
export const MCP_CHECK_TIMEOUT_MS = 5000;

function describeFailure(error: unknown, timedOut: boolean): string {
  if (timedOut) return "The check timed out.";
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return "Could not reach the local Astrolabe server.";
  return error instanceof Error ? error.message : "The request failed.";
}

export async function loadClaudeStatus(signal?: AbortSignal): Promise<string | null> {
  const response = await fetch("/api/claude/status", signal ? { signal } : {});
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = ErrorBody.safeParse(body);
    throw new ApiError(
      parsed.success ? parsed.data.error.message : `The server answered HTTP ${response.status}.`,
      response.status,
    );
  }
  const status = ClaudeStatus.safeParse(body);
  if (!status.success) {
    throw new ApiError("The server sent an answer this app version does not understand.", 502, {
      cause: status.error,
    });
  }
  return status.data.mcpLastCallAt;
}

/** Asks every few seconds while `poll` is true and stops for good once Claude has reached the server. */
export function useMcpReach(poll: boolean, intervalMs: number = MCP_POLL_MS): McpReach {
  const [reach, setReach] = useState<McpReach>({ kind: "checking" });
  const done = reach.kind === "reached";
  useEffect(() => {
    if (!poll || done) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const tick = () => {
      const request = new AbortController();
      let timedOut = false;
      const limit = window.setTimeout(() => {
        timedOut = true;
        request.abort();
      }, MCP_CHECK_TIMEOUT_MS);
      const stop = () => request.abort();
      controller.signal.addEventListener("abort", stop, { once: true });
      loadClaudeStatus(request.signal).then(
        (at) => {
          window.clearTimeout(limit);
          if (controller.signal.aborted) return;
          setReach(at === null ? { kind: "not_yet" } : { kind: "reached", at });
          if (at === null) timer = window.setTimeout(tick, intervalMs);
        },
        (error: unknown) => {
          window.clearTimeout(limit);
          if (controller.signal.aborted) return;
          setReach({ kind: "error", message: describeFailure(error, timedOut) });
          timer = window.setTimeout(tick, intervalMs);
        },
      );
    };
    tick();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [poll, done, intervalMs]);
  return reach;
}
