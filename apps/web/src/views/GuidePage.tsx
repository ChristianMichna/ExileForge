import { useEffect, useState } from "react";
import { Badge, Button, Callout, GuideNotes, Panel, Tabs } from "@astrolabe/ui";
import type { ProgressionStage } from "@astrolabe/contracts/build";
import type { GuideListView, GuideView } from "@astrolabe/contracts/guide";
import { CraftingSection } from "./GuideCrafting";
import { GearSection } from "./GuideGear";
import { loadGuideList, loadGuideView } from "../api/guides";
import { RichTextView, nameOf } from "../guide/RichTextView";
import { BuildFileExportButton } from "./BuildFileExport";
import { PageHeader } from "../shell/PageHeader";
import { useGuideId } from "../shell/route";

/** Result of a request that can still be running or have failed; never an empty default. */
type Loaded<T> =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly value: T };

function useLoaded<T>(load: (signal: AbortSignal) => Promise<T>, key: string): Loaded<T> {
  const [state, setState] = useState<{ key: string; loaded: Loaded<T> }>({
    key,
    loaded: { status: "loading" },
  });
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setState({ key, loaded: { status: "ready", value } });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          key,
          loaded: {
            status: "error",
            message: error instanceof Error ? error.message : "The request failed.",
          },
        });
      },
    );
    return () => controller.abort();
    // `load` is a fresh function each render; the key says when the request is another one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state.loaded : { status: "loading" };
}

export function GuidePage() {
  const guideId = useGuideId();
  return guideId === undefined ? <GuideList /> : <GuideDetail guideId={guideId} />;
}

function GuideList() {
  const list = useLoaded<GuideListView>(loadGuideList, "list");
  return (
    <div className="page">
      <PageHeader
        kicker="Guides"
        title="Saved guides"
        subtitle="Guides Claude finished for you on this computer."
      />
      {list.status === "loading" ? <p>Loading guides …</p> : null}
      {list.status === "error" ? (
        <Callout tone="danger" title="Guides could not be loaded" live>
          {list.message}
        </Callout>
      ) : null}
      {list.status === "ready" && list.value.guides.length === 0 ? (
        <Callout tone="info" title="No guide yet">
          When Claude finishes a guide in a run, it shows up here.
        </Callout>
      ) : null}
      {list.status === "ready" ? (
        <ul className="guide-list">
          {list.value.guides.map((item) => (
            <li key={item.guideId}>
              {"error" in item ? (
                <Callout tone="danger" title={`Guide ${item.guideId.slice(0, 8)}`}>
                  {item.error}
                </Callout>
              ) : (
                <a
                  className="guide-list__link"
                  href={`#/guide/${encodeURIComponent(item.guideId)}`}
                >
                  <strong>{item.ascendancyName ?? item.ascendancyId}</strong>{" "}
                  {item.mainSkillName ?? item.mainSkillId}{" "}
                  {item.current ? null : <Badge tone="warning">Older game data</Badge>}
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function GuideDetail({ guideId }: { guideId: string }) {
  const loaded = useLoaded<GuideView>((signal) => loadGuideView(guideId, signal), guideId);
  if (loaded.status === "loading") {
    return (
      <div className="page">
        <p>Loading the guide …</p>
      </div>
    );
  }
  if (loaded.status === "error") {
    return (
      <div className="page">
        <Callout tone="danger" title="The guide could not be loaded" live>
          {loaded.message}{" "}
          <Button size="sm" onClick={() => (window.location.hash = "#/guide")}>
            Back to the list
          </Button>
        </Callout>
      </div>
    );
  }
  return <GuideBody view={loaded.value} guideId={guideId} />;
}

function GuideBody({ view, guideId }: { view: GuideView; guideId: string }) {
  const { guide } = view;
  const { summary, mechanics } = guide;
  const ascendancy = nameOf(view, { kind: "ascendancy", id: summary.ascendancyId });
  const skill = nameOf(view, { kind: "gem", id: summary.mainSkillId });
  const [stageKey, setStageKey] = useState(guide.progression.stages[0]?.key ?? "");
  return (
    <div className="page">
      <PageHeader
        kicker={`Guide · ${guide.metadata.dataReleaseId} · PoB ${guide.metadata.pobVersion}`}
        title={`${ascendancy ?? summary.ascendancyId}: ${skill ?? summary.mainSkillId}`}
        actions={<BuildFileExportButton guideId={guideId} />}
      />
      {view.current ? null : (
        <Callout tone="warning" title="Older game data">
          This guide was built with {guide.metadata.dataReleaseId}; the app now runs with{" "}
          {view.catalogReleaseId}. Names are not shown until the guide is revalidated, and its
          numbers keep the release they were calculated with.
        </Callout>
      )}
      {view.unresolved.length > 0 ? (
        <Callout tone="warning" title="Some names and numbers are missing">
          The game data this app runs with does not know these entries, so they are shown as ids:{" "}
          {view.unresolved.join(", ")}
        </Callout>
      ) : null}
      <Panel title="Summary" kicker="At a glance">
        <GuideNotes>
          <p>
            <RichTextView text={summary.playstyle} view={view} />
          </p>
          <p>
            <RichTextView text={summary.scalingAxes} view={view} />
          </p>
        </GuideNotes>
        <div className="guide-columns">
          <div>
            <h3>Strengths</h3>
            <ul>
              {summary.strengths.map((t, i) => (
                <li key={i}>
                  <RichTextView text={t} view={view} />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Weaknesses</h3>
            <ul>
              {summary.weaknesses.map((t, i) => (
                <li key={i}>
                  <RichTextView text={t} view={view} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>
      <Panel title="How it works" kicker="Mechanics" variant="recessed">
        <GuideNotes>
          <p>
            <RichTextView text={mechanics.explanation} view={view} />
          </p>
        </GuideNotes>
        <ul>
          {mechanics.decisions.map((d, i) => (
            <li key={i}>
              {d.subject === undefined ? null : (
                <strong>{nameOf(view, d.subject) ?? d.subject.id}: </strong>
              )}
              <RichTextView text={d.reason} view={view} />
            </li>
          ))}
        </ul>
      </Panel>
      <Tabs
        label="Guide stages"
        variant="dial"
        value={stageKey}
        onChange={setStageKey}
        items={[...guide.progression.stages]
          .sort((a, b) => a.order - b.order)
          .map((stage) => ({
            id: stage.key,
            label: stage.label,
            hint: `Level ${stage.levelRange[0]}–${stage.levelRange[1]}`,
            content: <StageView stage={stage} view={view} />,
          }))}
      />
      <GearSection view={view} />
      <CraftingSection view={view} />
    </div>
  );
}

function StageView({ stage, view }: { stage: ProgressionStage; view: GuideView }) {
  const { state } = stage;
  return (
    <div className="stage">
      <Panel title={stage.label} kicker={`Level ${stage.levelRange[0]}–${stage.levelRange[1]}`}>
        <h3>What to do</h3>
        <ul>
          {stage.tasks.map((t, i) => (
            <li key={i}>
              <RichTextView text={t} view={view} />
            </li>
          ))}
        </ul>
        {stage.dangers.length > 0 ? (
          <>
            <h3>Dangers</h3>
            <ul>
              {stage.dangers.map((t, i) => (
                <li key={i}>
                  <RichTextView text={t} view={view} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Panel>
      <Panel title="Skills" kicker="Gems of this stage">
        <ul>
          {state.skills.map((skill) => (
            <li key={skill.key}>
              <strong>
                {nameOf(view, { kind: "gem", id: skill.gem.gemId }) ?? skill.gem.gemId}
              </strong>{" "}
              (level {skill.gem.level})
              {skill.supports.length > 0
                ? `: ${skill.supports
                    .map((s) => nameOf(view, { kind: "gem", id: s.gemId }) ?? s.gemId)
                    .join(", ")}`
                : null}
            </li>
          ))}
        </ul>
        <p>
          {state.tree.allocated.length} passive points allocated
          {state.tree.ascendancy.length > 0
            ? `, ${state.tree.ascendancy.length} ascendancy points`
            : ""}
          .
        </p>
      </Panel>
      {stage.rationale.length > 0 ? (
        <Panel title="Why" kicker="Decisions" variant="recessed">
          <ul>
            {stage.rationale.map((r, i) => (
              <li key={i}>
                {r.subject === undefined ? null : (
                  <strong>{nameOf(view, r.subject) ?? r.subject.id}: </strong>
                )}
                <RichTextView text={r.reason} view={view} />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
