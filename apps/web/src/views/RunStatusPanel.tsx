import { Badge, Button, Callout, Panel, type BadgeTone } from "@exileforge/ui";
import type { RunEventsState } from "../live/useRunEvents";

const PHASE_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  created: { label: "Waiting for Claude", tone: "neutral" },
  planning: { label: "Claude is planning", tone: "accent" },
  waiting_user: { label: "Waiting for you", tone: "warning" },
  paused: { label: "Paused", tone: "neutral" },
  done: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

/** Live status of the active run, driven only by the server's event stream. */
export function RunStatusPanel({
  state,
  onNewRun,
}: {
  state: RunEventsState;
  onNewRun: () => void;
}) {
  const { run, connection, protocolError } = state;
  const phase = PHASE_LABEL[run.phase] ?? { label: run.phase, tone: "neutral" as BadgeTone };
  return (
    <Panel
      kicker="Live status"
      title="Run"
      actions={
        <Button variant="secondary" size="sm" onClick={onNewRun}>
          New run
        </Button>
      }
    >
      <div className="run-status" aria-live="polite">
        <div className="run-status__row">
          <Badge tone={phase.tone}>{phase.label}</Badge>
          {connection !== "live" ? (
            <Badge tone="warning">
              {connection === "connecting" ? "Connecting…" : "Reconnecting…"}
            </Badge>
          ) : null}
        </div>
        <dl className="run-status__facts">
          <div>
            <dt>Current task</dt>
            <dd>
              {run.currentTask
                ? `${run.currentTask.task} (attempt ${run.currentTask.attempt})`
                : "none"}
            </dd>
          </div>
          <div>
            <dt>Accepted tasks</dt>
            <dd>{run.acceptedTasks}</dd>
          </div>
          <div>
            <dt>Sent back</dt>
            <dd>{run.rejectedAttempts}</dd>
          </div>
          <div>
            <dt>Calculations</dt>
            <dd>{run.calcCompleted}</dd>
          </div>
        </dl>
        {run.lastFindings.length > 0 ? (
          <Callout tone="warning" title="Last answer was sent back">
            <ul>
              {run.lastFindings.map((message, i) => (
                <li key={i}>{message}</li>
              ))}
            </ul>
          </Callout>
        ) : null}
        {run.calcFailure ? (
          <Callout tone="danger" title="A calculation failed">
            {run.calcFailure}
          </Callout>
        ) : null}
        {run.question ? (
          <Callout tone="info" title="Claude has a question">
            {run.question.question}
          </Callout>
        ) : null}
        {run.guideReady ? (
          <Callout tone="success" title="The guide is ready">
            The finished guide opens here once the guide view is available.
          </Callout>
        ) : null}
        {protocolError ? (
          <Callout tone="danger" title="Live status is incomplete" live>
            {protocolError}
          </Callout>
        ) : null}
      </div>
    </Panel>
  );
}
