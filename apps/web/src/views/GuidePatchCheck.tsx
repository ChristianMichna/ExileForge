import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Callout, Panel, type BadgeTone } from "@astrolabe/ui";
import {
  loadPatchCheck,
  refreshPatchCheck,
  type GuideCheck,
  type PatchCheckView,
} from "../api/patch-status";

/** How often the page asks again while the server is still checking. */
const POLL_MS = 3000;

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly view: PatchCheckView };

const VERDICT: Record<string, { tone: BadgeTone; label: string }> = {
  unaffected: { tone: "success", label: "Unaffected by the patch" },
  "needs-recalc": { tone: "warning", label: "Needs recalculation" },
  broken: { tone: "danger", label: "Broken: uses removed content" },
};

/** Saved guides against the current game data (F-19). */
export function GuidePatchCheck() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const apply = useCallback((request: Promise<PatchCheckView>, signal?: AbortSignal) => {
    request.then(
      (view) => {
        if (!signal?.aborted) setState({ kind: "ready", view });
      },
      (error: unknown) => {
        if (signal?.aborted) return;
        setState({
          kind: "failed",
          message: error instanceof Error ? error.message : "The check could not be loaded.",
        });
      },
    );
  }, []);

  const running = state.kind === "ready" && state.view.running;
  useEffect(() => {
    const controller = new AbortController();
    apply(loadPatchCheck(controller.signal), controller.signal);
    return () => controller.abort();
  }, [apply]);
  useEffect(() => {
    if (!running) return;
    const controller = new AbortController();
    const timer = window.setInterval(
      () => apply(loadPatchCheck(controller.signal), controller.signal),
      POLL_MS,
    );
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [running, apply]);

  if (state.kind === "loading") return null;
  if (state.kind === "failed") {
    return (
      <Callout tone="danger" title="Saved guides could not be checked" live>
        {state.message}
      </Callout>
    );
  }
  const { view } = state;
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
        <Button size="sm" onClick={() => apply(refreshPatchCheck())} disabled={view.running}>
          Check again
        </Button>
      }
    >
      <p>
        Checked against <code>{view.releaseId}</code>. {view.running ? "Checking…" : null}
      </p>
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

function GuideRow({ guide }: { guide: GuideCheck }) {
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
  const verdict = VERDICT[status.verdict] ?? { tone: "neutral" as const, label: status.verdict };
  const removed = status.findings.filter((f) => f.impact === "removed").length;
  const changed = status.findings.filter((f) => f.impact === "changed").length;
  return (
    <span>
      {label} <Badge tone={verdict.tone}>{verdict.label}</Badge>
      {status.findings.length > 0
        ? ` ${String(removed)} removed, ${String(changed)} changed of ${String(status.checkedReferences)} entities`
        : ` ${String(status.checkedReferences)} entities checked`}
    </span>
  );
}
