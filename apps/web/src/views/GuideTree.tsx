import { useMemo } from "react";
import { Callout, Panel, PassiveTree, buildTimeline, buildTreeView } from "@astrolabe/ui";
import type { GuideView, PassiveTreeData } from "@astrolabe/contracts/guide";
import { loadPassiveTree } from "../api/guides";
import { useLoaded } from "../api/use-loaded";
import { nameOf } from "../guide/RichTextView";

/*
 * The passive tree of a guide: its allocation, stage by stage, on the tree of the data release
 * the server runs with. A guide of another release is not drawn, because a node id can mean
 * something else there.
 */

function TreeBody({ view, data }: { view: GuideView; data: PassiveTreeData }) {
  const { guide } = view;
  const ascendancyId = guide.summary.ascendancyId;
  const prepared = useMemo(() => {
    const stages = [...guide.progression.stages].sort((a, b) => a.order - b.order);
    return {
      main: buildTreeView(data.passiveNodes, data.passiveGroups, {
        include: (n) => n.ascendancyId === undefined,
      }),
      ascendancy: buildTreeView(data.passiveNodes, data.passiveGroups, {
        include: (n) => n.ascendancyId === ascendancyId,
      }),
      timeline: buildTimeline(stages),
    };
  }, [data, guide, ascendancyId]);
  return (
    <>
      {data.skipped.length > 0 ? (
        <Callout tone="warning" title="Some tree entries could not be read">
          {data.skipped.join(", ")}
        </Callout>
      ) : null}
      <PassiveTree
        view={prepared.main}
        ascendancy={{
          name: nameOf(view, { kind: "ascendancy", id: ascendancyId }) ?? ascendancyId,
          view: prepared.ascendancy,
        }}
        timeline={prepared.timeline}
        provenance={{ kind: "gamedata", dataRelease: data.dataReleaseId }}
        allocationSource={`Allocation: guide ${guide.metadata.guideId}`}
      />
    </>
  );
}

export function TreeSection({ view }: { view: GuideView }) {
  if (!view.current) {
    return (
      <Panel title="Passive tree" kicker="By stage">
        <p role="status">
          The tree is drawn from the current game data. Revalidate this guide to see its passive
          tree.
        </p>
      </Panel>
    );
  }
  return <LoadedTree view={view} />;
}

function LoadedTree({ view }: { view: GuideView }) {
  const loaded = useLoaded((signal) => loadPassiveTree(signal), view.catalogReleaseId);
  return (
    <Panel title="Passive tree" kicker="By stage">
      {loaded.status === "loading" ? <p role="status">Loading tree data…</p> : null}
      {loaded.status === "error" ? (
        <Callout tone="danger" title="Tree data could not be loaded">
          {loaded.message}
        </Callout>
      ) : null}
      {loaded.status === "ready" ? <TreeBody view={view} data={loaded.value} /> : null}
    </Panel>
  );
}
