import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Callout, Panel, type BadgeTone } from "@astrolabe/ui";
import type {
  GuidePatchCheck,
  GuidePatchStatusView,
  PatchVerdict,
  ReleaseFactChange,
} from "@astrolabe/contracts/guide";
import { loadPatchCheck, refreshPatchCheck } from "../api/patch-status";

/** How long the page waits after an answer before asking again while the server is still checking. */
const POLL_MS = 3000;
const number = new Intl.NumberFormat("en-US");

interface State {
  /** The last answer the server gave; kept while a later request fails. */
  readonly view: GuidePatchStatusView | undefined;
  readonly problem: string | undefined;
}

const VERDICT: Record<PatchVerdict, { tone: BadgeTone; label: string }> = {
  unaffected: { tone: "success", label: "Unaffected by the patch" },
  "needs-recalc": { tone: "warning", label: "Needs recalculation" },
  broken: { tone: "danger", label: "Broken: uses removed content" },
};

const FACT_LABEL: Record<ReleaseFactChange, string> = {
  pobVersion: "Path of Building version",
  maxCharacterLevel: "maximum character level",
  passivePoints: "passive points",
  itemSlots: "item slots",
  rarities: "item rarities",
  classifications: "item classifications",
};

/** Saved guides against the current game data (F-19). */
export function GuidePatchCheckPanel() {
  const [state, setState] = useState<State>({ view: undefined, problem: undefined });
  const request = useRef<AbortController | undefined>(undefined);

  // One request at a time: a new one cancels the previous, so answers cannot overtake each other.
  const ask = useCallback((refresh: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    (refresh ? refreshPatchCheck(controller.signal) : loadPatchCheck(controller.signal)).then(
      (view) => {
        if (!controller.signal.aborted) setState({ view, problem: undefined });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState((s) => ({
          view: s.view,
          problem: error instanceof Error ? error.message : "The check could not be loaded.",
        }));
      },
    );
  }, []);

  const running = state.view?.running === true;
  useEffect(() => {
    ask(false);
    return () => request.current?.abort();
  }, [ask]);
  // While the server checks, ask again after each answer (not on a fixed clock).
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => ask(false), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [running, state, ask]);

  const { view, problem } = state;
  if (view === undefined) {
    if (problem === undefined) return null;
    return (
      <Callout tone="danger" title="Saved guides could not be checked" live>
        {problem}{" "}
        <Button size="sm" onClick={() => ask(false)}>
          Try again
        </Button>
      </Callout>
    );
  }
  if (!view.enabled) {
    return (
      <Callout tone="info" title="Saved guides are not checked">
        This installation does not keep game data releases, so guides are not compared with new
        patches.
      </Callout>
    );
  }
  return (
    <Panel
      title="Saved guides and the current game data"
      actions={
        <Button size="sm" onClick={() => ask(true)} disabled={view.running}>
          Check again
        </Button>
      }
    >
      <p>
        Checked against <code>{view.releaseId}</code>. {view.running ? "Checking…" : null}
      </p>
      {problem === undefined ? null : (
        <Callout tone="warning" title="The latest update failed" live>
          {problem} The list below is the last answer the server gave.{" "}
          <Button size="sm" onClick={() => ask(false)}>
            Try again
          </Button>
        </Callout>
      )}
      {view.error === undefined ? null : (
        <Callout tone="danger" title="The check stopped early" live>
          {view.error}
        </Callout>
      )}
      {view.guides.length === 0 && !view.running && view.error === undefined ? (
        <p>No saved guide needs a check for this game data.</p>
      ) : (
        <ul>
          {view.guides.map((guide) => (
            <li key={guide.guideId}>
              <GuideRow guide={guide} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function GuideRow({ guide }: { guide: GuidePatchCheck }) {
  const label = `Guide ${guide.guideId.slice(0, 8)}`;
  if (guide.outcome.kind === "error") {
    return (
      <span>
        {label} <Badge tone="danger">Could not be checked</Badge> {guide.outcome.message} (
        {guide.outcome.code})
      </span>
    );
  }
  const { status } = guide.outcome;
  const verdict = VERDICT[status.verdict];
  const removed = status.findings.filter((f) => f.impact === "removed").length;
  const changed = status.findings.filter((f) => f.impact === "changed").length;
  const facts = status.factChanges.map((f) => FACT_LABEL[f]);
  return (
    <span>
      {label} <Badge tone={verdict.tone}>{verdict.label}</Badge>{" "}
      {status.findings.length > 0
        ? `${number.format(removed)} removed, ${number.format(changed)} changed of ${number.format(status.checkedReferences)} entities.`
        : `${number.format(status.checkedReferences)} entities checked.`}
      {facts.length > 0 ? ` Changed in the game data: ${facts.join(", ")}.` : null}
    </span>
  );
}
