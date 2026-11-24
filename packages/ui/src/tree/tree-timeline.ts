// Level timeline of a passive tree: the allocation is played back point by
// point across the guide's stages. Input mirrors ProgressionStage
// (allocationOrder, respecs) from @exileforge/contracts/build; respecs of a
// stage are refunded before its new points are allocated.

export interface TreeStageInput {
  readonly key: string;
  readonly label: string;
  readonly levelRange: readonly [number, number];
  /** New passives of this stage in allocation order. */
  readonly allocationOrder: readonly string[];
  /** Passives refunded at the start of this stage. */
  readonly respecs: readonly string[];
}

export interface TimelineStep {
  readonly stage: number;
  readonly op: "allocate" | "refund";
  readonly nodeId: string;
}

export interface TimelineStage {
  readonly key: string;
  readonly label: string;
  readonly levelRange: readonly [number, number];
  /** Index of the first step of this stage. */
  readonly from: number;
  /** Index after the last step of this stage. */
  readonly to: number;
}

export interface TreeTimeline {
  readonly steps: readonly TimelineStep[];
  readonly stages: readonly TimelineStage[];
  /** Inconsistent input (refund of an unallocated node, double allocation). */
  readonly issues: readonly string[];
}

/** Allocation at a cursor position, split for highlighting. */
export interface TimelineState {
  /** Stage the cursor is in. */
  readonly stage: number;
  /** All nodes allocated at the cursor. */
  readonly allocated: ReadonlySet<string>;
  /** Nodes allocated in the current stage, with their 1-based point number. */
  readonly added: ReadonlyMap<string, number>;
  /** Nodes refunded in the current stage and not allocated again. */
  readonly refunded: ReadonlySet<string>;
}

export function buildTimeline(stages: readonly TreeStageInput[]): TreeTimeline {
  const steps: TimelineStep[] = [];
  const out: TimelineStage[] = [];
  const issues: string[] = [];
  const allocated = new Set<string>();
  stages.forEach((s, stage) => {
    const from = steps.length;
    for (const nodeId of s.respecs) {
      if (!allocated.has(nodeId)) {
        issues.push(`${s.label}: refund of ${nodeId}, which is not allocated`);
        continue;
      }
      allocated.delete(nodeId);
      steps.push({ stage, op: "refund", nodeId });
    }
    for (const nodeId of s.allocationOrder) {
      if (allocated.has(nodeId)) {
        issues.push(`${s.label}: ${nodeId} is allocated twice`);
        continue;
      }
      allocated.add(nodeId);
      steps.push({ stage, op: "allocate", nodeId });
    }
    out.push({ key: s.key, label: s.label, levelRange: s.levelRange, from, to: steps.length });
  });
  return { steps, stages: out, issues };
}

/**
 * Stage of a cursor. A cursor on a stage boundary belongs to the stage that
 * ends there, unless `hint` names the stage that starts there.
 */
export function stageAt(timeline: TreeTimeline, cursor: number, hint?: number): number {
  const h = hint === undefined ? undefined : timeline.stages[hint];
  if (h && cursor >= h.from && cursor <= h.to && hint !== undefined) return hint;
  const i = timeline.stages.findIndex((s) => cursor <= s.to && cursor > s.from);
  if (i >= 0) return i;
  return cursor <= 0 ? 0 : Math.max(0, timeline.stages.length - 1);
}

/** State after the first `cursor` steps (see stageAt for `hint`). */
export function stateAt(timeline: TreeTimeline, cursor: number, hint?: number): TimelineState {
  const end = Math.max(0, Math.min(cursor, timeline.steps.length));
  const stage = stageAt(timeline, end, hint);
  const stageFrom = timeline.stages[stage]?.from ?? 0;
  const allocated = new Set<string>();
  const added = new Map<string, number>();
  const refunded = new Set<string>();
  let point = 0;
  for (let i = 0; i < end; i++) {
    const step = timeline.steps[i];
    if (!step) break;
    const current = i >= stageFrom;
    if (step.op === "allocate") {
      allocated.add(step.nodeId);
      if (current) {
        point += 1;
        added.set(step.nodeId, point);
        refunded.delete(step.nodeId);
      }
    } else {
      allocated.delete(step.nodeId);
      if (current) refunded.add(step.nodeId);
    }
  }
  return { stage, allocated, added, refunded };
}
