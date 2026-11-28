import type { PassiveNodeId } from "@astrolabe/contracts";
import type { OptimizerConfig } from "./config.ts";
import { OptimizerError } from "./errors.ts";
import { Evaluations } from "./evaluations.ts";
import type { TreeGraph } from "./graph.ts";
import { objectiveMetrics, Scorer } from "./score.ts";
import { TreeSearch } from "./search.ts";
import type { FloorViolation, Metrics, Objective, StopReason, TreeEvaluator } from "./types.ts";

export interface ProgressionStageInput {
  key: string;
  /** Points of the main tree available in this stage (from the level and config). */
  budget: number;
  /** Replaces the plan's objective for this stage (e.g. more life early on). */
  objective?: Objective;
  /**
   * Relative gain on the rule's metric that lets this stage respec (1 = double).
   * Without it the stage never respecs. Only used when the input has a `respec` rule.
   */
  respecMinGainRatio?: number;
}

/**
 * When a respec is worth it. The default is none: stages extend the previous
 * one. A stage may only respec when the freely re-picked tree is better by
 * the stage's `respecMinGainRatio` on `metric` and in the objective's total,
 * adds no floor violation, refunds at most `maxRefund` points, and fewer than
 * `maxRespecs` respecs were used before.
 */
export interface RespecRule {
  maxRespecs: number;
  maxRefund: number;
  /** PoB output the gain is measured on, e.g. the one the plan's objective weighs most. */
  metric: string;
}

export interface ProgressionInput {
  graph: TreeGraph;
  /** The endgame tree (main tree, class start excluded); every stage is a subset of it. */
  target: readonly PassiveNodeId[];
  stages: readonly ProgressionStageInput[];
  /** Default objective of all stages. */
  objective: Objective;
  evaluator: TreeEvaluator;
  config: OptimizerConfig;
  priorityNodeIds?: readonly PassiveNodeId[];
  respec?: RespecRule;
  signal?: AbortSignal;
}

export interface ProgressionStageResult {
  key: string;
  budget: number;
  /** Full allocation of the stage in allocation order. */
  allocated: PassiveNodeId[];
  /** Nodes new in this stage, in the order to allocate them. */
  allocationOrder: PassiveNodeId[];
  /** Nodes of the previous stage given up here; empty unless the respec rule allowed it. */
  respecs: PassiveNodeId[];
  unspent: number;
  metrics: Metrics;
  calcId: string;
  violations: FloorViolation[];
  feasible: boolean;
  stoppedBy: StopReason;
}

export interface ProgressionResult {
  stages: ProgressionStageResult[];
  evaluations: number;
  failedEvaluations: { nodeCount: number; error: { kind: string; detail?: string } }[];
  failedEvaluationCount: number;
}

/**
 * Orders the endgame tree into stages: each stage extends the previous one
 * by the nodes of the target tree that PoB measures as most valuable for the
 * stage's objective, so no respec is needed. A `respec` rule lets a stage
 * re-pick its tree when that gains a lot (see `RespecRule`).
 */
export async function optimizeProgression(input: ProgressionInput): Promise<ProgressionResult> {
  const { graph, config } = input;
  const target = input.target.map(String);
  const targetSet = new Set(target);
  if (targetSet.size !== target.length) {
    throw new OptimizerError("invalid_input", "target contains duplicate nodes");
  }
  const unknown = target.filter((id) => !graph.has(id) || id === graph.start);
  if (unknown.length > 0) {
    throw new OptimizerError(
      "invalid_input",
      `Target nodes not in the main tree: ${unknown.slice(0, 5).join(", ")}`,
    );
  }
  if (!graph.isConnected(targetSet)) {
    throw new OptimizerError(
      "invalid_input",
      "The target tree is not connected to the class start",
    );
  }
  if (input.stages.length === 0) throw new OptimizerError("invalid_input", "No stages given");
  let previous = 0;
  for (const stage of input.stages) {
    if (!Number.isInteger(stage.budget) || stage.budget < previous) {
      throw new OptimizerError(
        "invalid_input",
        `Stage ${stage.key}: budgets must be integers that do not decrease`,
      );
    }
    previous = stage.budget;
  }

  const rule = input.respec;
  if (
    rule !== undefined &&
    (!Number.isInteger(rule.maxRespecs) ||
      rule.maxRespecs < 0 ||
      !Number.isInteger(rule.maxRefund) ||
      rule.maxRefund < 0 ||
      input.stages.some((s) => s.respecMinGainRatio !== undefined && !(s.respecMinGainRatio > 0)))
  ) {
    throw new OptimizerError(
      "invalid_input",
      "respec rule: counts must be whole numbers, stage gains > 0",
    );
  }
  const metrics = [
    ...new Set([
      ...(rule === undefined || rule.maxRespecs === 0 ? [] : [rule.metric]),
      ...[input.objective, ...input.stages.map((s) => s.objective ?? input.objective)].flatMap(
        objectiveMetrics,
      ),
    ]),
  ];
  if (metrics.length === 0) {
    throw new OptimizerError("invalid_input", "The objective has no weights or floors");
  }
  const evals = new Evaluations(input.evaluator, metrics, config.maxEvaluations, input.signal);
  const priority = new Set((input.priorityNodeIds ?? []).map(String));

  const results: ProgressionStageResult[] = [];
  let state: string[] = [];
  let respecsUsed = 0;
  for (const stage of input.stages) {
    const objective = stage.objective ?? input.objective;
    const [startOutcome] = await evals.evaluate([state]);
    if (!startOutcome?.ok) {
      throw new OptimizerError(
        "base_failed",
        `Stage ${stage.key}: the starting state could not be calculated`,
      );
    }
    const scorer = new Scorer(objective, startOutcome.metrics, config.floorPenalty);
    const search = new TreeSearch(
      graph,
      evals,
      scorer,
      config,
      { blocked: new Set(), locked: new Set(state), priority },
      state,
    );
    const budget = Math.min(stage.budget, target.length);
    // Nested stages must spend their points, even when the best step is not an improvement.
    const grown = await search.grow(budget, { eligible: targetSet, spendAll: true });
    let stoppedBy: StopReason = search.order.length === target.length ? "target_complete" : grown;
    let order: string[] = [...search.order];
    let final = await search.score(order);
    let respecs: string[] = [];
    if (
      rule !== undefined &&
      stage.respecMinGainRatio !== undefined &&
      rule.maxRespecs > 0 &&
      respecsUsed < rule.maxRespecs &&
      state.length > 0 &&
      final !== undefined
    ) {
      // What would the best tree of this size be if nothing were kept?
      const free = new TreeSearch(
        graph,
        evals,
        scorer,
        config,
        { blocked: new Set(), locked: new Set(), priority },
        [],
      );
      const freeStop = await free.grow(budget, { eligible: targetSet, spendAll: true });
      const alt = await free.score(free.order);
      if (alt !== undefined) {
        const kept = new Set(free.order);
        const refunded = state.filter((id) => !kept.has(id));
        const nestedValue = final.outcome.metrics[rule.metric];
        const altValue = alt.outcome.metrics[rule.metric];
        if (nestedValue === undefined || altValue === undefined) {
          throw new OptimizerError(
            "evaluator_failed",
            `Stage ${stage.key}: the respec metric ${rule.metric} was not measured`,
          );
        }
        const big =
          nestedValue > 0 ? altValue / nestedValue - 1 >= stage.respecMinGainRatio : altValue > 0;
        if (
          refunded.length > 0 &&
          refunded.length <= rule.maxRefund &&
          big &&
          alt.score >= final.score &&
          scorer.violations(alt.outcome.metrics).length <=
            scorer.violations(final.outcome.metrics).length
        ) {
          respecsUsed += 1;
          respecs = refunded;
          order = [...free.order];
          final = alt;
          stoppedBy = free.order.length === target.length ? "target_complete" : freeStop;
        }
      }
    }
    if (final === undefined) {
      throw new OptimizerError(
        "evaluator_failed",
        `Stage ${stage.key}: result could not be calculated`,
      );
    }
    let finalOutcome = final.outcome;
    if (input.evaluator.confirm !== undefined) {
      let confirmedOutcome;
      try {
        confirmedOutcome = await input.evaluator.confirm(order as PassiveNodeId[], metrics);
      } catch (cause) {
        throw new OptimizerError("evaluator_failed", `Stage ${stage.key}: confirming failed`, {
          cause,
        });
      }
      if (!confirmedOutcome.ok) {
        throw new OptimizerError(
          "evaluator_failed",
          `Stage ${stage.key}: result could not be confirmed: ${confirmedOutcome.error.kind}`,
        );
      }
      finalOutcome = confirmedOutcome;
    }
    const before = new Set(state);
    const violations = scorer.violations(finalOutcome.metrics);
    results.push({
      key: stage.key,
      budget: stage.budget,
      allocated: order as PassiveNodeId[],
      allocationOrder: order.filter((id) => !before.has(id)) as PassiveNodeId[],
      respecs: respecs as PassiveNodeId[],
      unspent: stage.budget - order.length,
      metrics: finalOutcome.metrics,
      calcId: finalOutcome.calcId,
      violations,
      feasible: violations.length === 0,
      stoppedBy,
    });
    state = order;
  }
  return {
    stages: results,
    evaluations: evals.evaluations,
    failedEvaluations: evals.failures,
    failedEvaluationCount: evals.failedCount,
  };
}
