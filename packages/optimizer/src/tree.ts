import type { PassiveNodeId } from "@exileforge/contracts";
import type { OptimizerConfig } from "./config.ts";
import { OptimizerError } from "./errors.ts";
import { Evaluations } from "./evaluations.ts";
import type { TreeGraph } from "./graph.ts";
import { objectiveMetrics, Scorer } from "./score.ts";
import { TreeSearch } from "./search.ts";
import type { Objective, StopReason, TreeEvaluator, TreeOptimizeResult } from "./types.ts";

export interface TreeOptimizeInput {
  graph: TreeGraph;
  /** Current main-tree allocation, class start and ascendancy nodes excluded. */
  allocated: readonly PassiveNodeId[];
  /** Points the main tree may use in total (allocated nodes count). */
  budget: number;
  objective: Objective;
  evaluator: TreeEvaluator;
  config: OptimizerConfig;
  /** Must be allocated in the result (paths to them are added first). */
  requiredNodeIds?: readonly PassiveNodeId[];
  /** Must not be allocated. */
  forbiddenNodeIds?: readonly PassiveNodeId[];
  /** Currently allocated nodes that may not be removed. */
  lockedNodeIds?: readonly PassiveNodeId[];
  /** Nodes to measure first (e.g. SkillProfile.relevantNodes). */
  priorityNodeIds?: readonly PassiveNodeId[];
  signal?: AbortSignal;
}

function requireKnown(graph: TreeGraph, ids: readonly string[], what: string): void {
  const unknown = ids.filter((id) => !graph.has(id));
  if (unknown.length > 0) {
    throw new OptimizerError(
      "invalid_input",
      `${what} not in the main tree: ${unknown.slice(0, 5).join(", ")}`,
    );
  }
}

/**
 * Finds the allocation within `budget` that maximizes the objective: greedy
 * growth by measured gain per point, then single-node swaps. Every value is
 * measured by the evaluator; the result is feasible only if all floors hold.
 */
export async function optimizeTree(input: TreeOptimizeInput): Promise<TreeOptimizeResult> {
  const { graph, config, objective, evaluator } = input;
  const allocated = input.allocated.map(String);
  const required = (input.requiredNodeIds ?? []).map(String);
  const forbidden = new Set((input.forbiddenNodeIds ?? []).map(String));
  const locked = new Set((input.lockedNodeIds ?? []).map(String));

  if (!Number.isInteger(input.budget) || input.budget < 0) {
    throw new OptimizerError("invalid_input", "budget must be a non-negative integer");
  }
  if (new Set(allocated).size !== allocated.length) {
    throw new OptimizerError("invalid_input", "allocated contains duplicate nodes");
  }
  requireKnown(graph, allocated, "Allocated nodes");
  requireKnown(graph, required, "Required nodes");
  if (required.includes(graph.start) || locked.has(graph.start)) {
    throw new OptimizerError("invalid_input", "The class start node is implicit");
  }
  if (allocated.includes(graph.start)) {
    throw new OptimizerError(
      "invalid_input",
      "The class start node is implicit, do not allocate it",
    );
  }
  if (!graph.isConnected(new Set(allocated))) {
    throw new OptimizerError("invalid_input", "The allocation is not connected to the class start");
  }
  if (allocated.length > input.budget) {
    throw new OptimizerError("infeasible", "More nodes allocated than the budget allows");
  }
  for (const id of [...allocated, ...required]) {
    if (forbidden.has(id)) throw new OptimizerError("invalid_input", `Node ${id} is forbidden`);
  }
  for (const id of locked) {
    if (!allocated.includes(id)) {
      throw new OptimizerError("invalid_input", `Locked node ${id} is not allocated`);
    }
  }

  const metrics = objectiveMetrics(objective);
  if (metrics.length === 0) {
    throw new OptimizerError("invalid_input", "The objective has no weights or floors");
  }
  const evals = new Evaluations(evaluator, metrics, config.maxEvaluations, input.signal);

  const [baseOutcome] = await evals.evaluate([allocated]);
  if (!baseOutcome?.ok) {
    throw new OptimizerError(
      "base_failed",
      `The starting state could not be calculated: ${baseOutcome?.error.kind ?? "no evaluation budget"}`,
    );
  }
  const baseMetrics = baseOutcome.metrics;
  const scorer = new Scorer(objective, baseMetrics, config.floorPenalty);

  const lockedAll = new Set([...locked, ...required]);
  const search = new TreeSearch(
    graph,
    evals,
    scorer,
    config,
    {
      blocked: forbidden,
      locked: lockedAll,
      priority: new Set((input.priorityNodeIds ?? []).map(String)),
    },
    allocated,
  );

  // Required nodes first: their paths are part of the plan before anything is optimized.
  for (const id of required) {
    if (search.nodes.has(id)) continue;
    const reached = graph.search(new Set([graph.start, ...search.order]), forbidden, graph.size);
    if (!reached.has(id)) {
      throw new OptimizerError("infeasible", `Required node ${id} cannot be reached`);
    }
    const path = graph.pathTo(id, reached);
    search.order.push(...path);
    for (const node of path) lockedAll.add(node);
  }
  if (search.order.length > input.budget) {
    throw new OptimizerError("infeasible", "The required nodes need more points than the budget");
  }

  let priorSource: TreeOptimizeResult["priorSource"] = "exploration";
  const nodePowerFn = evaluator.nodePower?.bind(evaluator);
  // An empty priority list means "measure nothing in advance" (explore); only an
  // absent list asks for the full sweep, which takes about half an hour.
  if (nodePowerFn !== undefined && input.priorityNodeIds?.length !== 0) {
    let power;
    try {
      power = await nodePowerFn(
        search.order as PassiveNodeId[],
        input.priorityNodeIds === undefined ? undefined : [...input.priorityNodeIds],
        metrics,
      );
    } catch (cause) {
      throw new OptimizerError("evaluator_failed", "Node power measurement failed", { cause });
    }
    if (power !== undefined) {
      for (const entry of power) {
        if (forbidden.has(entry.nodeId) || entry.pathCost <= 0) continue;
        // An entry without a weighted metric says nothing; never read it as zero gain.
        if (Object.keys(objective.weights).some((m) => !Number.isFinite(entry.deltas[m]))) continue;
        search.priors.set(entry.nodeId, {
          gain: scorer.deltaScore(entry.deltas),
          cost: entry.pathCost,
        });
      }
    }
  }

  if (search.priors.size > 0) priorSource = "nodePower";
  const stoppedBy: StopReason = await search.grow(input.budget, {
    spendAll: config.spendAllPoints,
  });
  const refineStoppedBy = await search.refine();

  const scored = await search.score(search.order);
  if (scored === undefined) {
    throw new OptimizerError("evaluator_failed", "The final state could not be calculated");
  }
  let final = scored;
  let confirmed = false;
  if (evaluator.confirm !== undefined) {
    let outcome;
    try {
      outcome = await evaluator.confirm(search.order as PassiveNodeId[], metrics);
    } catch (cause) {
      throw new OptimizerError("evaluator_failed", "Confirming the result failed", { cause });
    }
    if (!outcome.ok) {
      throw new OptimizerError(
        "evaluator_failed",
        `The result could not be confirmed: ${outcome.error.kind}`,
      );
    }
    final = { score: scorer.score(outcome.metrics), outcome };
    confirmed = true;
  }
  const initial = new Set(allocated);
  const kept = new Set(search.order);
  const violations = scorer.violations(final.outcome.metrics);
  return {
    allocated: search.order as PassiveNodeId[],
    added: search.order.filter((id) => !initial.has(id)) as PassiveNodeId[],
    removed: allocated.filter((id) => !kept.has(id)) as PassiveNodeId[],
    budget: input.budget,
    unspent: input.budget - search.order.length,
    baseMetrics,
    metrics: final.outcome.metrics,
    calcId: final.outcome.calcId,
    score: final.score,
    violations,
    feasible: violations.length === 0,
    stoppedBy,
    refineStoppedBy,
    truncated: evals.truncated,
    confirmed,
    priorSource,
    evaluations: evals.evaluations,
    failedEvaluations: evals.failures,
    failedEvaluationCount: evals.failedCount,
  };
}
