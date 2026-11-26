import type { PassiveNodeId } from "@astrolabe/contracts";
import { describe, expect, it } from "vitest";
import { OptimizerError, optimizeTree } from "../src/index.ts";
import { config, FakeEvaluator, graphOf, type FakeModel, type FixtureNode } from "./fixtures.ts";

const id = (s: string): PassiveNodeId => s as PassiveNodeId;

/*
 * start - a1 - a2 - a3 (damage branch, payoff at the end)
 *   |
 *   b1 - b2 (life branch)
 *   |
 *   c1 - c2 (resistance branch)
 */
const nodes: FixtureNode[] = [
  { id: "start", edges: ["a1", "b1", "c1"], classStart: true },
  { id: "a1", edges: ["a2"] },
  { id: "a2", edges: ["a3"] },
  { id: "a3" },
  { id: "b1", edges: ["b2"] },
  { id: "b2" },
  { id: "c1", edges: ["c2"] },
  { id: "c2" },
  { id: "other-start", edges: ["a1"], classStart: true },
  { id: "asc1", edges: ["a1"], ascendancy: true },
];
const model: FakeModel = {
  stats: {
    a1: { dmg: 5 },
    a2: { dmg: 5 },
    a3: { dmg: 60 },
    b1: { life: 10 },
    b2: { life: 20 },
    c1: { res: 10 },
    c2: { res: 30 },
  },
};
const graph = graphOf(nodes);

describe("optimizeTree", () => {
  it("finds the best 3-point tree and spends all points", async () => {
    const evaluator = new FakeEvaluator(model);
    const result = await optimizeTree({
      graph,
      allocated: [],
      budget: 3,
      objective: { weights: { Dps: 1 } },
      evaluator,
      config,
    });
    expect(result.allocated).toEqual(["a1", "a2", "a3"]);
    expect(result.unspent).toBe(0);
    expect(result.feasible).toBe(true);
    expect(result.priorSource).toBe("exploration");
    expect(result.metrics["Dps"]).toBe(170);
    expect(result.baseMetrics["Dps"]).toBe(100);
    expect(result.calcId).toBe("fake-a1,a2,a3");
  });

  it("never walks through ascendancy nodes or foreign class starts", async () => {
    const evaluator = new FakeEvaluator({
      stats: { ...model.stats, asc1: { dmg: 1000 }, "other-start": { dmg: 1000 } },
    });
    const result = await optimizeTree({
      graph,
      allocated: [],
      budget: 4,
      objective: { weights: { Dps: 1 } },
      evaluator,
      config,
    });
    expect(result.allocated).not.toContain("asc1");
    expect(result.allocated).not.toContain("other-start");
  });

  it("meets a floor even when damage would be higher elsewhere", async () => {
    const evaluator = new FakeEvaluator(model);
    const result = await optimizeTree({
      graph,
      allocated: [],
      budget: 4,
      objective: { weights: { Dps: 1 }, floors: { Res: 40 } },
      evaluator,
      config,
    });
    expect(result.feasible).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.metrics["Res"]).toBeGreaterThanOrEqual(40);
    expect(result.allocated).toEqual(expect.arrayContaining(["c1", "c2"]));
  });

  it("reports an unreachable floor instead of hiding it", async () => {
    const evaluator = new FakeEvaluator(model);
    const result = await optimizeTree({
      graph,
      allocated: [],
      budget: 2,
      objective: { weights: { Dps: 1 }, floors: { Res: 100 } },
      evaluator,
      config,
    });
    expect(result.feasible).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({ metric: "Res", required: 100 });
  });

  it("leaves out nodes whose game id marks them as unlocked by another node", async () => {
    const locked = graphOf(
      [
        { id: "start", edges: ["a1", "l1"], classStart: true },
        { id: "a1" },
        { id: "l1", edges: ["l2"], gameId: "locked_fixture_1" },
        { id: "l2", gameId: "locked_fixture_2" },
      ],
      "start",
      ["locked_fixture_"],
    );
    expect(locked.has("a1")).toBe(true);
    expect(locked.has("l1")).toBe(false);
    expect(locked.has("l2")).toBe(false);
  });

  it("holds a metric to another metric measured in the same evaluation", async () => {
    const evaluator = new FakeEvaluator(model);
    const result = await optimizeTree({
      graph,
      allocated: [],
      budget: 2,
      objective: { weights: { Dps: 1 }, floorsFromMetrics: { Res: "Life" } },
      evaluator,
      config,
    });
    expect(result.feasible).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      metric: "Res",
      required: result.metrics["Life"],
      actual: result.metrics["Res"],
    });
    const met = await optimizeTree({
      graph,
      allocated: [],
      budget: 2,
      objective: { weights: { Dps: 1 }, floorsFromMetrics: { Dps: "Life" } },
      evaluator,
      config,
    });
    expect(met.feasible).toBe(true);
  });

  it("swaps a weak node for a better one when the budget is full", async () => {
    const evaluator = new FakeEvaluator(model);
    const result = await optimizeTree({
      graph,
      allocated: [id("b1"), id("b2")],
      budget: 2,
      objective: { weights: { Dps: 1, Life: 0.01 } },
      evaluator,
      config: { ...config, maxPathCost: 1 },
    });
    // The life branch is replaced step by step by damage nodes where it pays off.
    expect(result.removed.length).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(0);
  });

  it("honors required, forbidden and locked nodes", async () => {
    const evaluator = new FakeEvaluator(model);
    const result = await optimizeTree({
      graph,
      allocated: [id("b1")],
      budget: 4,
      objective: { weights: { Dps: 1 } },
      evaluator,
      config,
      requiredNodeIds: [id("c2")],
      forbiddenNodeIds: [id("a3")],
      lockedNodeIds: [id("b1")],
    });
    expect(result.allocated).toEqual(expect.arrayContaining(["b1", "c1", "c2"]));
    expect(result.allocated).not.toContain("a3");
  });

  it("uses node power as prior and needs fewer evaluations", async () => {
    const plain = new FakeEvaluator(model);
    const powered = new FakeEvaluator(model, { withNodePower: true });
    const run = (evaluator: FakeEvaluator) =>
      optimizeTree({
        graph,
        allocated: [],
        budget: 3,
        objective: { weights: { Dps: 1 } },
        evaluator,
        config,
      });
    const a = await run(plain);
    const b = await run(powered);
    expect(b.priorSource).toBe("nodePower");
    expect(powered.nodePowerCalls).toBe(1);
    expect(b.allocated.slice().sort()).toEqual(a.allocated.slice().sort());
    expect(b.evaluations).toBeLessThanOrEqual(a.evaluations);
  });

  it("does not ask for node power when the priority list is empty", async () => {
    const powered = new FakeEvaluator(model, { withNodePower: true });
    const result = await optimizeTree({
      graph,
      allocated: [],
      budget: 3,
      objective: { weights: { Dps: 1 } },
      evaluator: powered,
      config,
      priorityNodeIds: [],
    });
    expect(powered.nodePowerCalls).toBe(0);
    expect(result.priorSource).toBe("exploration");
  });

  it("skips states the engine cannot calculate and reports them", async () => {
    const evaluator = new FakeEvaluator({
      ...model,
      failWhen: (state) => state.includes("a3"),
    });
    const result = await optimizeTree({
      graph,
      allocated: [],
      budget: 3,
      objective: { weights: { Dps: 1 } },
      evaluator,
      config,
    });
    expect(result.allocated).not.toContain("a3");
    expect(result.failedEvaluationCount).toBeGreaterThan(0);
    expect(result.failedEvaluations[0]?.error.kind).toBe("calc_failed");
  });

  it("fails loudly when the start state cannot be calculated", async () => {
    const evaluator = new FakeEvaluator({ ...model, failWhen: () => true });
    await expect(
      optimizeTree({
        graph,
        allocated: [],
        budget: 3,
        objective: { weights: { Dps: 1 } },
        evaluator,
        config,
      }),
    ).rejects.toMatchObject({ kind: "base_failed" });
  });

  it("treats a missing metric as a failure, not as zero", async () => {
    const evaluator = new FakeEvaluator(model);
    await expect(
      optimizeTree({
        graph,
        allocated: [],
        budget: 3,
        objective: { weights: { Unknown: 1 } },
        evaluator,
        config,
      }),
    ).rejects.toMatchObject({ kind: "base_failed" });
  });

  it("wraps an unusable engine with the cause", async () => {
    const cause = new Error("pool down");
    const evaluator = {
      evaluate: () => Promise.reject(cause),
    };
    const error = await optimizeTree({
      graph,
      allocated: [],
      budget: 3,
      objective: { weights: { Dps: 1 } },
      evaluator,
      config,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OptimizerError);
    expect((error as OptimizerError).kind).toBe("evaluator_failed");
    expect((error as OptimizerError).cause).toBe(cause);
  });

  it("stops at the evaluation budget and says so", async () => {
    const evaluator = new FakeEvaluator(model);
    const result = await optimizeTree({
      graph,
      allocated: [],
      budget: 7,
      objective: { weights: { Dps: 1 } },
      evaluator,
      config: { ...config, maxEvaluations: 3 },
    });
    expect(result.evaluations).toBeLessThanOrEqual(3);
    expect(result.stoppedBy).toBe("evaluation_budget");
    expect(result.unspent).toBeGreaterThan(0);
  });

  it("rejects invalid input", async () => {
    const base = {
      graph,
      budget: 3,
      objective: { weights: { Dps: 1 } },
      evaluator: new FakeEvaluator(model),
      config,
    };
    await expect(optimizeTree({ ...base, allocated: [id("a2")] })).rejects.toMatchObject({
      kind: "invalid_input",
    });
    await expect(optimizeTree({ ...base, allocated: [id("asc1")] })).rejects.toMatchObject({
      kind: "invalid_input",
    });
    await expect(optimizeTree({ ...base, allocated: [], budget: -1 })).rejects.toMatchObject({
      kind: "invalid_input",
    });
    await expect(
      optimizeTree({ ...base, allocated: [], requiredNodeIds: [id("a3")], budget: 2 }),
    ).rejects.toMatchObject({ kind: "infeasible" });
    await expect(
      optimizeTree({ ...base, allocated: [], objective: { weights: {} } }),
    ).rejects.toMatchObject({ kind: "invalid_input" });
  });

  it("is deterministic", async () => {
    const run = () =>
      optimizeTree({
        graph,
        allocated: [],
        budget: 5,
        objective: { weights: { Dps: 1, Life: 0.5 } },
        evaluator: new FakeEvaluator(model),
        config,
      });
    expect(await run()).toEqual(await run());
  });

  it("reaches the brute-force optimum on a tree with synergy", async () => {
    const synergyModel: FakeModel = {
      stats: { a1: { dmg: 10 }, a2: { dmg: 10 }, b1: { dmg: 12 }, b2: { dmg: 12 }, c1: { dmg: 1 } },
      synergy: [{ a: "a2", b: "b2", mult: 2 }],
    };
    const g = graphOf([
      { id: "start", edges: ["a1", "b1", "c1"], classStart: true },
      { id: "a1", edges: ["a2"] },
      { id: "a2" },
      { id: "b1", edges: ["b2"] },
      { id: "b2" },
      { id: "c1" },
    ]);
    const evaluator = new FakeEvaluator(synergyModel);
    const result = await optimizeTree({
      graph: g,
      allocated: [],
      budget: 4,
      objective: { weights: { Dps: 1 } },
      evaluator,
      config,
    });
    // Brute force over all node subsets of size 4 that stay connected.
    const ids = ["a1", "a2", "b1", "b2", "c1"];
    let best = 0;
    for (let mask = 0; mask < 1 << ids.length; mask++) {
      const subset = ids.filter((_, i) => mask & (1 << i));
      if (subset.length !== 4 || !g.isConnected(new Set(subset))) continue;
      const dps = (await evaluator.evaluate([subset], ["Dps"]))[0];
      if (dps?.ok) best = Math.max(best, dps.metrics["Dps"] as number);
    }
    expect(result.metrics["Dps"]).toBe(best);
  });
});

describe("optimizeTree robustness", () => {
  it("does not get stuck on targets the engine cannot calculate", async () => {
    // The nearest nodes all fail; farther valid ones must still be found.
    const evaluator = new FakeEvaluator(model);
    const failing = new Set(["a1", "b1"]);
    const result = await optimizeTree({
      graph,
      allocated: [],
      budget: 2,
      objective: { weights: { Dps: 1, Life: 1, Res: 1 } },
      evaluator: {
        evaluate: (states, metrics) =>
          evaluator
            .evaluate(states, metrics)
            .then((out) =>
              out.map((o, i) =>
                (states[i] ?? []).length === 1 && failing.has(states[i]?.[0] ?? "")
                  ? { ok: false as const, error: { kind: "calc_failed" } }
                  : o,
              ),
            ),
      },
      config: { ...config, candidatesPerRound: 2, explorationShare: 1 },
    });
    expect(result.allocated).toEqual(["c1", "c2"]);
    expect(result.failedEvaluationCount).toBe(2);
  });

  it("flags a run cut short by the evaluation budget", async () => {
    const result = await optimizeTree({
      graph,
      allocated: [],
      budget: 3,
      objective: { weights: { Dps: 1 } },
      evaluator: new FakeEvaluator(model),
      config: { ...config, maxEvaluations: 2 },
    });
    expect(result.truncated).toBe(true);
    expect(result.stoppedBy).toBe("evaluation_budget");
  });

  it("survives a transient engine failure and still allocates", async () => {
    let calls = 0;
    const inner = new FakeEvaluator(model);
    const result = await optimizeTree({
      graph,
      allocated: [],
      budget: 1,
      objective: { weights: { Dps: 1 } },
      evaluator: {
        evaluate: (states, metrics) =>
          inner.evaluate(states, metrics).then((out) =>
            out.map((o, i) => {
              if (states[i]?.[0] === "a1" && ++calls === 1) {
                return { ok: false as const, error: { kind: "timeout" } };
              }
              return o;
            }),
          ),
      },
      config: { ...config, candidatesPerRound: 1, explorationShare: 1 },
    });
    expect(result.failedEvaluationCount).toBeGreaterThanOrEqual(1);
    expect(result.allocated.length).toBe(1);
  });

  it("takes the numbers of the confirming calculation", async () => {
    const inner = new FakeEvaluator(model);
    const result = await optimizeTree({
      graph,
      allocated: [],
      budget: 1,
      objective: { weights: { Dps: 1 } },
      evaluator: {
        evaluate: (s, m) => inner.evaluate(s, m),
        confirm: () =>
          Promise.resolve({ ok: true as const, metrics: { Dps: 999 }, calcId: "confirmed" }),
      },
      config,
    });
    expect(result.confirmed).toBe(true);
    expect(result.calcId).toBe("confirmed");
    expect(result.metrics["Dps"]).toBe(999);
  });

  it("rejects the class start as required node", async () => {
    await expect(
      optimizeTree({
        graph,
        allocated: [],
        budget: 3,
        objective: { weights: { Dps: 1 } },
        evaluator: new FakeEvaluator(model),
        config,
        requiredNodeIds: [id("start")],
      }),
    ).rejects.toMatchObject({ kind: "invalid_input" });
  });
});
