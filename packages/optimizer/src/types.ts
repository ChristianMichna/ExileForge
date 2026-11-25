import type { PassiveNodeId } from "@astrolabe/contracts";

/** PoB output values of one tree state, keyed by PoB metric name. */
export type Metrics = Readonly<Record<string, number>>;

export interface EvalSuccess {
  ok: true;
  /** Absolute metric values as PoB calculated them. */
  metrics: Metrics;
  calcId: string;
}

export interface EvalFailure {
  ok: false;
  error: { kind: string; detail?: string };
}

export type EvalOutcome = EvalSuccess | EvalFailure;

/** Marginal effect of one node (with its path) on the metrics, as PoB measured it. */
export interface NodePowerEntry {
  nodeId: PassiveNodeId;
  deltas: Metrics;
  pathCost: number;
}

/**
 * What the optimizer needs from the calculation engine. Implemented over the
 * calc service (see `createPobTreeEvaluator`) and by fakes in tests. Values
 * are always the engine's; a failed state is a failure, never a zero.
 */
export interface TreeEvaluator {
  /**
   * Calculates each state (the full main-tree allocation, class start
   * excluded) and returns the outcomes in the same order. Throws only if the
   * engine itself is unusable; a state that cannot be calculated is a failure
   * outcome.
   */
  evaluate(
    states: readonly (readonly PassiveNodeId[])[],
    metrics: readonly string[],
  ): Promise<EvalOutcome[]>;
  /**
   * Optional: measures nodes against the state `base` in one pass. Returns
   * undefined when the engine does not offer it.
   */
  /**
   * Optional: calculates the finished state in full (no deltas), so the
   * numbers in the result are the engine's absolute ones.
   */
  confirm?:
    | ((allocated: readonly PassiveNodeId[], metrics: readonly string[]) => Promise<EvalOutcome>)
    | undefined;
  nodePower?:
    | ((
        base: readonly PassiveNodeId[],
        candidates: readonly PassiveNodeId[] | undefined,
        metrics: readonly string[],
      ) => Promise<NodePowerEntry[] | undefined>)
    | undefined;
}

/**
 * Target function, set by the planner or the user; the numbers it weighs are
 * measured by the engine. Gains are normalized by the starting value of each
 * metric so differently scaled metrics compare.
 */
export interface Objective {
  /** Metric -> weight of the relative gain (negative weights punish growth). */
  weights: Readonly<Record<string, number>>;
  /** Metric -> minimum value (hard constraint, e.g. resistances, attributes, spirit). */
  floors?: Readonly<Record<string, number>>;
  /** Metric -> normalization; default is the starting value, or 1 if that is 0. */
  scales?: Readonly<Record<string, number>>;
}

export interface FloorViolation {
  metric: string;
  required: number;
  actual: number;
}

export type StopReason =
  | "budget_spent"
  | "no_gain"
  | "no_candidates"
  | "evaluation_failed"
  | "evaluation_budget"
  | "target_complete";

export type RefineStop = "converged" | "max_rounds" | "evaluation_budget" | "evaluation_failed";

export interface TreeOptimizeResult {
  /** Full main-tree allocation (class start excluded) in allocation order. */
  allocated: PassiveNodeId[];
  added: PassiveNodeId[];
  removed: PassiveNodeId[];
  budget: number;
  unspent: number;
  /** Metrics of the starting state and of the result, from the engine. */
  baseMetrics: Metrics;
  metrics: Metrics;
  calcId: string;
  /** Normalized objective value of the result against the start (derived from engine values). */
  score: number;
  violations: FloorViolation[];
  /** True if no floor is violated. */
  feasible: boolean;
  stoppedBy: StopReason;
  refineStoppedBy: RefineStop;
  /** True if the evaluation budget cut a round short, so some candidates were never measured. */
  truncated: boolean;
  /** True if the final numbers come from a full confirming calculation of the result. */
  confirmed: boolean;
  priorSource: "nodePower" | "exploration";
  evaluations: number;
  /** States the engine could not calculate (first entries), with the engine's error. */
  failedEvaluations: { nodeCount: number; error: { kind: string; detail?: string } }[];
  failedEvaluationCount: number;
}
