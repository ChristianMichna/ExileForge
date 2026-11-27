import { useEffect, useState, type ReactNode } from "react";
import { Badge, Callout } from "@astrolabe/ui";
import type { RunLive } from "../live/run-state";
import type { Connection } from "../live/useRunEvents";

/** How long a run may wait for Claude before the page explains what to check. */
export const CONNECT_PATIENCE_MS = 45_000;

/** Plain-language hint for the one answer mistake seen in practice, or undefined. */
export function hintForFindings(findings: readonly string[]): string | undefined {
  const text = findings.join(" ").toLowerCase();
  if (text.includes("expected object, received string")) {
    return (
      "Claude sent its answer as quoted text instead of a structured object. " +
      "Astrolabe sends it back on its own. If this repeats, tell Claude: " +
      "“Submit the answer as a JSON object, not as a string.”"
    );
  }
  return undefined;
}

type StepState = "done" | "current" | "todo";

const STEP_TONE = { done: "success", current: "accent", todo: "neutral" } as const;
const STEP_LABEL = { done: "Done", current: "Now", todo: "Next" } as const;

function Step({
  state,
  title,
  children,
}: {
  state: StepState;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="setup-step">
      <Badge tone={STEP_TONE[state]}>{STEP_LABEL[state]}</Badge>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </li>
  );
}

/**
 * Step by step setup next to the connect buttons. It only reports what the run shows: Claude has
 * connected once the run leaves "created"; before that it says so and, after a while, what to check.
 */
export function ClaudeConnectionStatus({
  run,
  connection,
  patienceMs = CONNECT_PATIENCE_MS,
}: {
  run: RunLive;
  /** State of the live stream: without it the run phase says nothing about Claude. */
  connection: Connection;
  patienceMs?: number;
}) {
  const live = connection === "live";
  const connected = run.phase !== "created";
  const [impatient, setImpatient] = useState(false);
  useEffect(() => {
    if (connected || !live) return;
    const timer = window.setTimeout(() => setImpatient(true), patienceMs);
    return () => window.clearTimeout(timer);
  }, [connected, live, patienceMs]);

  const hint = hintForFindings(run.lastFindings);
  const summary = !live
    ? "Checking the run status…"
    : run.phase === "failed"
      ? "The run failed."
      : run.phase === "done"
        ? "The run is done."
        : connected
          ? "Claude is connected."
          : "Waiting for Claude to connect.";
  // A finished run needs no setup help; the run panel shows its result.
  if (live && run.phase === "done") {
    return (
      <p className="connect-status" role="status">
        {summary}
      </p>
    );
  }
  const planning: StepState =
    run.phase === "failed" ? "todo" : live && connected ? "current" : "todo";
  return (
    <div className="connect-status">
      <p className="ef-visually-hidden" role="status">
        {summary}
      </p>
      <ol className="setup-steps">
        <Step state="done" title="Run created">
          Astrolabe is ready and waits for Claude.
        </Step>
        <Step
          state={live && connected ? "done" : "current"}
          title={live && connected ? "Claude is connected" : "Waiting for Claude to connect"}
        >
          {live && connected
            ? "Claude picked up the run and Astrolabe checks every answer."
            : "Install the Claude extension once, open Claude Desktop, and paste the start sentence into a new chat."}
        </Step>
        <Step state={planning} title="Planning">
          Claude plans step by step; Path of Building measures each answer.
        </Step>
      </ol>
      {live && !connected && impatient ? (
        <Callout tone="warning" title="Claude has not connected yet" live>
          <ul>
            <li>
              Install the Claude extension with the button above, then restart Claude Desktop.
            </li>
            <li>
              Open a new chat in Claude Desktop and paste the start sentence from your clipboard.
            </li>
            <li>Check that the Astrolabe tools are switched on in the chat&rsquo;s tool menu.</li>
            <li>
              The session code expires after a while. Press &ldquo;Plan with Claude&rdquo; again for
              a new one.
            </li>
          </ul>
        </Callout>
      ) : null}
      {hint ? (
        <Callout tone="info" title="Claude&rsquo;s last answer had the wrong shape" live>
          {hint}
        </Callout>
      ) : null}
    </div>
  );
}
