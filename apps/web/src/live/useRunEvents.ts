import { useEffect, useState } from "react";
import { RunEvent } from "@exileforge/contracts/events";
import { applyRunEvent, EMPTY_RUN, type RunLive } from "./run-state";

export type Connection = "connecting" | "live" | "reconnecting";

export interface RunEventsState {
  readonly run: RunLive;
  readonly connection: Connection;
  /** Set when the server sent an event this app version does not understand. */
  readonly protocolError: string | undefined;
}

const EVENT_TYPES = [
  "run.phase",
  "task.started",
  "task.submitted",
  "task.accepted",
  "task.rejected",
  "calc.completed",
  "calc.failed",
  "ask_user",
  "feedback.queued",
  "guide.ready",
] as const;

/**
 * Live state of a run from `/api/runs/:id/events` (SSE). The browser
 * reconnects by itself and resumes after the last event id; the reducer
 * ignores replays, so a reconnect never double counts.
 */
export function useRunEvents(runId: string | undefined): RunEventsState {
  const [state, setState] = useState<RunEventsState>({
    run: EMPTY_RUN,
    connection: "connecting",
    protocolError: undefined,
  });
  useEffect(() => {
    setState({ run: EMPTY_RUN, connection: "connecting", protocolError: undefined });
    if (runId === undefined) return;
    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
    source.onopen = () => setState((s) => ({ ...s, connection: "live" }));
    source.onerror = () => setState((s) => ({ ...s, connection: "reconnecting" }));
    const onMessage = (message: MessageEvent<string>) => {
      let json: unknown;
      try {
        json = JSON.parse(message.data);
      } catch {
        setState((s) => ({ ...s, protocolError: "The server sent an unreadable event." }));
        return;
      }
      const parsed = RunEvent.safeParse(json);
      if (!parsed.success) {
        setState((s) => ({
          ...s,
          protocolError: "The server sent an event this app does not know.",
        }));
        return;
      }
      setState((s) => ({ ...s, run: applyRunEvent(s.run, parsed.data) }));
    };
    for (const type of EVENT_TYPES) source.addEventListener(type, onMessage as EventListener);
    return () => source.close();
  }, [runId]);
  return state;
}
