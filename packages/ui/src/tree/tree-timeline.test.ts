import { describe, expect, it } from "vitest";
import type { TreeStageInput } from "./tree-timeline";
import { buildTimeline, stageAt, stateAt } from "./tree-timeline";

const stages: TreeStageInput[] = [
  { key: "s1", label: "One", levelRange: [1, 10], allocationOrder: ["a", "b"], respecs: [] },
  { key: "s2", label: "Two", levelRange: [11, 20], allocationOrder: ["c", "d"], respecs: ["b"] },
];

describe("tree timeline", () => {
  const t = buildTimeline(stages);

  it("refunds a stage's respecs before its new points", () => {
    expect(t.steps.map((s) => `${s.op}:${s.nodeId}`)).toEqual([
      "allocate:a",
      "allocate:b",
      "refund:b",
      "allocate:c",
      "allocate:d",
    ]);
    expect(t.stages.map((s) => [s.from, s.to])).toEqual([
      [0, 2],
      [2, 5],
    ]);
    expect(t.issues).toEqual([]);
  });

  it("splits the state into kept, new (numbered) and refunded", () => {
    const end = stateAt(t, 5);
    expect(end.stage).toBe(1);
    expect([...end.allocated].sort()).toEqual(["a", "c", "d"]);
    expect([...end.added]).toEqual([
      ["c", 1],
      ["d", 2],
    ]);
    expect([...end.refunded]).toEqual(["b"]);
    const mid = stateAt(t, 1);
    expect([...mid.added]).toEqual([["a", 1]]);
  });

  it("gives a boundary to the stage that ends there unless a hint says otherwise", () => {
    expect(stageAt(t, 2)).toBe(0);
    expect(stageAt(t, 2, 1)).toBe(1);
    expect(stateAt(t, 2, 1).added.size).toBe(0);
    expect(stageAt(t, 0)).toBe(0);
    expect(stageAt(t, 99)).toBe(1);
  });

  it("reports inconsistent input instead of hiding it", () => {
    const bad = buildTimeline([
      { key: "x", label: "X", levelRange: [1, 2], allocationOrder: ["a", "a"], respecs: ["z"] },
    ]);
    expect(bad.issues).toEqual([
      "X: refund of z, which is not allocated",
      "X: a is allocated twice",
    ]);
    expect(bad.steps).toHaveLength(1);
  });
});
