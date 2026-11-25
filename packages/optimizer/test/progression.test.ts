import type { PassiveNodeId } from "@astrolabe/contracts";
import { describe, expect, it } from "vitest";
import { optimizeProgression } from "../src/index.ts";
import { config, FakeEvaluator, graphOf, type FakeModel } from "./fixtures.ts";

const graph = graphOf([
  { id: "start", edges: ["a1", "b1"], classStart: true },
  { id: "a1", edges: ["a2"] },
  { id: "a2", edges: ["a3"] },
  { id: "a3" },
  { id: "b1", edges: ["b2"] },
  { id: "b2" },
]);
const target = ["a1", "a2", "a3", "b1", "b2"] as PassiveNodeId[];
const model: FakeModel = {
  stats: { a1: { dmg: 5 }, a2: { dmg: 5 }, a3: { dmg: 40 }, b1: { life: 30 }, b2: { life: 30 } },
};

describe("optimizeProgression", () => {
  it("builds nested stages that end in the target tree", async () => {
    const result = await optimizeProgression({
      graph,
      target,
      stages: [
        { key: "early", budget: 2 },
        { key: "mid", budget: 4 },
        { key: "end", budget: 5 },
      ],
      objective: { weights: { Dps: 1, Life: 0.1 } },
      evaluator: new FakeEvaluator(model),
      config,
    });
    expect(result.stages.map((s) => s.allocated.length)).toEqual([2, 4, 5]);
    for (const [i, stage] of result.stages.entries()) {
      const before = new Set(result.stages[i - 1]?.allocated ?? []);
      for (const node of before) expect(stage.allocated).toContain(node);
      expect(stage.respecs).toEqual([]);
      expect(stage.allocationOrder.every((n) => !before.has(n))).toBe(true);
    }
    expect([...(result.stages[2]?.allocated ?? [])].sort()).toEqual([...target].sort());
    expect(result.stages[2]?.stoppedBy).toBe("target_complete");
  });

  it("keeps every stage connected in allocation order", async () => {
    const result = await optimizeProgression({
      graph,
      target,
      stages: [
        { key: "s1", budget: 1 },
        { key: "s2", budget: 3 },
        { key: "s3", budget: 5 },
      ],
      objective: { weights: { Dps: 1 } },
      evaluator: new FakeEvaluator(model),
      config,
    });
    const last = result.stages[2]?.allocated ?? [];
    const placed = new Set<string>();
    for (const node of last) {
      placed.add(node);
      expect(graph.isConnected(placed)).toBe(true);
    }
  });

  it("lets a stage objective change the order", async () => {
    const run = (weights: Record<string, number>) =>
      optimizeProgression({
        graph,
        target,
        stages: [{ key: "early", budget: 2, objective: { weights } }],
        objective: { weights: { Dps: 1 } },
        evaluator: new FakeEvaluator(model),
        config,
      });
    const life = await run({ Life: 1 });
    const dmg = await run({ Dps: 1 });
    expect(life.stages[0]?.allocated).toEqual(["b1", "b2"]);
    expect(dmg.stages[0]?.allocated).toEqual(["a1", "a2"]);
  });

  it("reports unspent points when the target is smaller than the budget", async () => {
    const result = await optimizeProgression({
      graph,
      target,
      stages: [{ key: "big", budget: 8 }],
      objective: { weights: { Dps: 1 } },
      evaluator: new FakeEvaluator(model),
      config,
    });
    expect(result.stages[0]?.unspent).toBe(3);
  });

  it("rejects bad input", async () => {
    const base = {
      graph,
      objective: { weights: { Dps: 1 } },
      evaluator: new FakeEvaluator(model),
      config,
    };
    await expect(
      optimizeProgression({
        ...base,
        target,
        stages: [
          { key: "a", budget: 3 },
          { key: "b", budget: 2 },
        ],
      }),
    ).rejects.toMatchObject({ kind: "invalid_input" });
    await expect(
      optimizeProgression({
        ...base,
        target: ["a3"] as PassiveNodeId[],
        stages: [{ key: "a", budget: 1 }],
      }),
    ).rejects.toMatchObject({ kind: "invalid_input" });
    await expect(optimizeProgression({ ...base, target, stages: [] })).rejects.toMatchObject({
      kind: "invalid_input",
    });
  });
});
