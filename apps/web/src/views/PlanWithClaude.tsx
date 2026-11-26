import { useState, type FormEvent } from "react";
import { Badge, Button, Callout, Panel } from "@astrolabe/ui";
import { BuildRequest } from "@astrolabe/contracts/build";
import { ApiError, createRun, type CreatedRun } from "../api/client";
import intake from "../config/intake-defaults.json";
import { getDesktopBridge, type OpenClaudeResult } from "../desktop/bridge";
import { useDesktopStatus } from "../desktop/useDesktopStatus";
import { useRunEvents } from "../live/useRunEvents";
import { PageHeader } from "../shell/PageHeader";
import { GuidePatchCheckPanel } from "./GuidePatchCheck";
import { RunStatusPanel } from "./RunStatusPanel";

const RUN_KEY = "astrolabe.activeRunId";

function loadRunId(): string | undefined {
  try {
    return window.localStorage.getItem(RUN_KEY) ?? undefined;
  } catch {
    return undefined; // storage blocked: the run just is not remembered
  }
}

function saveRunId(id: string | undefined): void {
  try {
    if (id === undefined) window.localStorage.removeItem(RUN_KEY);
    else window.localStorage.setItem(RUN_KEY, id);
  } catch {
    // Nothing to do: remembering the run is a convenience only.
  }
}

export function PlanWithClaude() {
  const desktop = useDesktopStatus();
  return (
    <div className="page">
      <PageHeader
        kicker="Plan"
        title="Plan with Claude"
        subtitle="Describe your skill idea. Claude plans the variants step by step; every number comes from Path of Building."
      />
      {desktop.kind === "browser" ? (
        <Callout tone="warning" title="Planning needs the desktop app">
          This page runs in a normal browser. Open Astrolabe from its installer or the desktop
          shortcut to plan builds.
        </Callout>
      ) : desktop.kind === "loading" ? (
        <Callout tone="info" title="Starting…" live>
          Waiting for the local server.
        </Callout>
      ) : desktop.kind === "unreachable" ? (
        <Callout tone="danger" title="The app status is unavailable" live>
          {desktop.message}
        </Callout>
      ) : desktop.status.server.state === "failed" ? (
        <Callout tone="danger" title="The local server did not start" live>
          {desktop.status.server.message}
        </Callout>
      ) : desktop.status.server.state === "starting" ? (
        <Callout tone="info" title="Starting the local server…" live>
          This takes a few seconds.
        </Callout>
      ) : (
        <>
          <GuidePatchCheckPanel />
          <Planner
            dataReleaseId={desktop.status.server.dataReleaseId}
            calcEngine={desktop.status.server.calcEngine}
            {...(desktop.status.server.catalogOnlyReason === undefined
              ? {}
              : { catalogOnlyReason: desktop.status.server.catalogOnlyReason })}
          />
        </>
      )}
    </div>
  );
}

function Planner({
  dataReleaseId,
  calcEngine,
  catalogOnlyReason,
}: {
  dataReleaseId: string;
  catalogOnlyReason?: string;
  calcEngine: "fake" | "pob" | "none";
}) {
  const [runId, setRunId] = useState<string | undefined>(loadRunId);
  const [created, setCreated] = useState<CreatedRun | undefined>();
  const events = useRunEvents(calcEngine === "none" ? undefined : runId);

  const onCreated = (run: CreatedRun) => {
    saveRunId(run.runId);
    setCreated(run);
    setRunId(run.runId);
  };
  const reset = () => {
    saveRunId(undefined);
    setCreated(undefined);
    setRunId(undefined);
  };

  if (calcEngine === "none") {
    return (
      <Callout tone="warning" title="Catalog only: planning is paused">
        {catalogOnlyReason ?? "There is no matching Path of Building for this game data yet."}{" "}
        Browsing game data and checking saved guides still work. Planning returns as soon as a
        matching Path of Building release is installed.
      </Callout>
    );
  }

  return (
    <>
      {calcEngine === "fake" ? (
        <Callout tone="warning" title="Path of Building is not connected yet">
          Calculations in this version come from <code>calc-fake</code>. They are invented values
          for testing the planning loop, not real build numbers.
        </Callout>
      ) : null}
      {runId === undefined ? (
        <IntakeForm dataReleaseId={dataReleaseId} onCreated={onCreated} />
      ) : (
        <>
          <ConnectClaude runId={runId} created={created} />
          <RunStatusPanel state={events} onNewRun={reset} />
        </>
      )}
    </>
  );
}

type Focus = BuildRequest["preferences"]["focus"];
type Pace = BuildRequest["preferences"]["pace"];
type Level = BuildRequest["preferences"]["complexityTolerance"];

function IntakeForm({
  dataReleaseId,
  onCreated,
}: {
  dataReleaseId: string;
  onCreated: (run: CreatedRun) => void;
}) {
  const [idea, setIdea] = useState("");
  const [focus, setFocus] = useState<Focus>("allround");
  const [pace, setPace] = useState<Pace>("balanced");
  const [complexity, setComplexity] = useState<Level>("medium");
  const [leveling, setLeveling] = useState(intake.defaults.leveling);
  const [endgame, setEndgame] = useState(intake.defaults.endgame);
  const [hardcore, setHardcore] = useState(false);
  const [ssf, setSsf] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const candidate = {
      dataReleaseId,
      skillIdea: idea.trim(),
      mode: { hardcore, ssf },
      budget: { leveling, endgame },
      preferences: {
        playstyleTags: [],
        focus,
        pace,
        complexityTolerance: complexity,
        defenceLayers: [],
      },
      exclusions: [],
    };
    const request = BuildRequest.safeParse(candidate);
    if (!request.success) {
      setError(`The form does not match the build request contract: ${request.error.message}`);
      setBusy(false);
      return;
    }
    try {
      onCreated(await createRun(request.data));
    } catch (e) {
      setError(
        e instanceof ApiError || e instanceof Error ? e.message : "The run could not be created.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel kicker="Step 1" title="What do you want to play?">
      <form className="intake" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span className="field__label">Skill idea</span>
          <textarea
            required
            minLength={3}
            maxLength={2000}
            rows={4}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="e.g. a fast fire caster that clears maps and still survives bosses"
          />
        </label>
        <div className="intake__row">
          <Select
            label="Focus"
            value={focus}
            onChange={setFocus}
            options={[
              ["allround", "All-round"],
              ["mapping", "Mapping"],
              ["bossing", "Bossing"],
            ]}
          />
          <Select
            label="Pace"
            value={pace}
            onChange={setPace}
            options={[
              ["tanky", "Tanky"],
              ["balanced", "Balanced"],
              ["fast", "Fast"],
            ]}
          />
          <Select
            label="Complexity"
            value={complexity}
            onChange={setComplexity}
            options={[
              ["low", "Low"],
              ["medium", "Medium"],
              ["high", "High"],
            ]}
          />
        </div>
        <div className="intake__row">
          <Select
            label="Leveling budget"
            value={leveling}
            onChange={setLeveling}
            options={intake.budgetTiers.map((t) => [t.id, t.label])}
          />
          <Select
            label="Endgame budget"
            value={endgame}
            onChange={setEndgame}
            options={intake.budgetTiers.map((t) => [t.id, t.label])}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={hardcore}
              onChange={(e) => setHardcore(e.target.checked)}
            />
            Hardcore
          </label>
          <label className="check">
            <input type="checkbox" checked={ssf} onChange={(e) => setSsf(e.target.checked)} />
            Solo self-found
          </label>
        </div>
        {error ? (
          <Callout tone="danger" title="The run could not be created" live>
            {error}
          </Callout>
        ) : null}
        <div>
          <Button type="submit" variant="primary" busy={busy} disabled={idea.trim().length < 3}>
            Create run
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function Select<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function ConnectClaude({ runId, created }: { runId: string; created: CreatedRun | undefined }) {
  const bridge = getDesktopBridge();
  const [result, setResult] = useState<OpenClaudeResult | undefined>();
  const [note, setNote] = useState<{ ok: boolean; message: string } | undefined>();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setResult(undefined);
    setNote(undefined);
    try {
      await action();
    } catch (e) {
      setNote({ ok: false, message: e instanceof Error ? e.message : "The action failed." });
    } finally {
      setBusy(false);
    }
  };

  if (!bridge) return null;
  return (
    <Panel kicker="Step 2" title="Connect Claude">
      <div className="connect">
        <p>
          Claude Desktop does the planning. Astrolabe checks every answer with Path of Building and
          sends it back if something does not hold.
        </p>
        <div className="connect__actions">
          <Button
            variant="primary"
            busy={busy}
            onClick={() =>
              void run(async () => {
                setResult(await bridge.openClaude(runId));
              })
            }
          >
            Plan with Claude
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void run(async () => setNote(await bridge.installClaudeExtension()))}
          >
            Install Claude extension
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void run(async () => setNote(await bridge.copyClaudeCodeCommand()))}
          >
            Copy Claude Code command
          </Button>
        </div>
        {created && !result ? (
          <p className="connect__hint">
            Session code <code>{created.sessionCode}</code>, valid until{" "}
            {new Date(created.expiresAt).toLocaleTimeString("en-US")}.
          </p>
        ) : null}
        {result ? (
          <Callout
            tone={result.claudeDesktopOpened ? "success" : "warning"}
            title={
              result.claudeDesktopOpened ? "Claude Desktop is opening" : "Open Claude yourself"
            }
            live
          >
            {result.claudeDesktopOpened
              ? "The start sentence is on your clipboard. Paste it into a new chat."
              : `${result.notOpenedReason ?? ""} The start sentence is on your clipboard.`}
            <br />
            Session code <code>{result.sessionCode}</code>, valid until{" "}
            {new Date(result.expiresAt).toLocaleTimeString("en-US")}.
          </Callout>
        ) : null}
        {note ? (
          <Callout
            tone={note.ok ? "success" : "danger"}
            title={note.ok ? "Done" : "That did not work"}
            live
          >
            {note.message}
          </Callout>
        ) : null}
        <p className="connect__hint">
          Run <Badge tone="neutral">{runId.slice(0, 8)}</Badge>
        </p>
      </div>
    </Panel>
  );
}
