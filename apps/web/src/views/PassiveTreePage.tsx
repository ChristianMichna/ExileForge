import { useEffect, useState } from "react";
import { PassiveGroup, PassiveNode } from "@astrolabe/contracts/catalog";
import { PassiveNodeId } from "@astrolabe/contracts/common";
import type { PassiveTreeView, TreeTimeline } from "@astrolabe/ui";
import { Callout, PassiveTree, buildTimeline, buildTreeView } from "@astrolabe/ui";
import { z } from "zod";
import { PageHeader } from "../shell/PageHeader";

// The fixture is generated from a data release by
// apps/web/scripts/make-tree-fixture.mjs. Geometry and passives are game
// data; the allocation is a made-up sample (see the script).
const TreeFixture = z.object({
  dataRelease: z.string().min(1),
  pobVersion: z.string().min(1),
  classId: z.string().min(1),
  ascendancy: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  passiveNodes: z.array(PassiveNode),
  passiveGroups: z.array(PassiveGroup),
  // the timeline fields of ProgressionStage (whose refined schema cannot be picked)
  sampleStages: z.array(
    z.object({
      key: z.string().min(1).max(64),
      label: z.string().min(1).max(120),
      levelRange: z.tuple([z.int().positive(), z.int().positive()]),
      allocationOrder: z.array(PassiveNodeId),
      respecs: z.array(PassiveNodeId),
    }),
  ),
});

interface Loaded {
  readonly main: PassiveTreeView;
  readonly ascendancy: { readonly name: string; readonly view: PassiveTreeView };
  readonly timeline: TreeTimeline;
  readonly dataRelease: string;
  readonly classId: string;
}

type State =
  { status: "loading" } | { status: "ready"; data: Loaded } | { status: "error"; message: string };

async function load(): Promise<Loaded> {
  const raw: unknown = (await import("../fixtures/passive-tree.json")).default;
  const fixture = TreeFixture.parse(raw);
  const ascId = fixture.ascendancy.id;
  return {
    main: buildTreeView(fixture.passiveNodes, fixture.passiveGroups, {
      include: (n) => n.ascendancyId === undefined,
    }),
    ascendancy: {
      name: fixture.ascendancy.name,
      view: buildTreeView(fixture.passiveNodes, fixture.passiveGroups, {
        include: (n) => n.ascendancyId === ascId,
      }),
    },
    timeline: buildTimeline(fixture.sampleStages),
    dataRelease: fixture.dataRelease,
    classId: fixture.classId,
  };
}

export function PassiveTreePage() {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page page--wide page--compact">
      <PageHeader
        kicker="Sample build · made-up allocation"
        title="Passive Tree"
        subtitle={
          state.status === "ready"
            ? `${state.data.classId} · ${state.data.ascendancy.name} · scrub the timeline to watch the tree grow`
            : "Loading"
        }
      />
      {state.status === "loading" ? (
        <p className="tree-page__status" role="status">
          Loading tree data…
        </p>
      ) : null}
      {state.status === "error" ? (
        <Callout tone="danger" title="Tree data could not be loaded">
          {state.message}
        </Callout>
      ) : null}
      {state.status === "ready" ? (
        <PassiveTree
          view={state.data.main}
          ascendancy={state.data.ascendancy}
          timeline={state.data.timeline}
          initialStage={1}
          provenance={{ kind: "gamedata", dataRelease: state.data.dataRelease }}
          allocationSource="Allocation: sample fixture"
        />
      ) : null}
    </div>
  );
}
