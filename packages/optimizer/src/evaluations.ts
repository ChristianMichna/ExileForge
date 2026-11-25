import type { PassiveNodeId } from "@exileforge/contracts";
import { OptimizerError } from "./errors.ts";
import type { EvalFailure, EvalOutcome, Metrics, TreeEvaluator } from "./types.ts";

const MAX_RECORDED_FAILURES = 20;
/** Calc error kinds that say nothing about the state itself; such failures are not cached. */
const TRANSIENT_KINDS: ReadonlySet<string> = new Set(["timeout", "worker_crashed"]);

/**
 * Evaluation cache with a call budget. A state is calculated at most once per
 * run; the number of engine calls (cache misses) is bounded.
 */
export class Evaluations {
  private readonly cache = new Map<string, EvalOutcome>();
  private used = 0;
  failedCount = 0;
  /** A round was cut short by the evaluation budget. */
  truncated = false;
  readonly failures: { nodeCount: number; error: EvalFailure["error"] }[] = [];

  constructor(
    private readonly evaluator: TreeEvaluator,
    readonly metrics: readonly string[],
    private readonly maxEvaluations: number,
    private readonly signal?: AbortSignal,
  ) {}

  get evaluations(): number {
    return this.used;
  }

  get remaining(): number {
    return this.maxEvaluations - this.used;
  }

  static key(nodes: readonly string[]): string {
    return [...nodes].sort().join("|");
  }

  /** Outcomes in the order of `states`; null where the evaluation budget did not allow a call. */
  async evaluate(states: readonly (readonly string[])[]): Promise<(EvalOutcome | null)[]> {
    if (this.signal?.aborted) throw new OptimizerError("aborted", "Optimization was aborted");
    const keys = states.map((s) => Evaluations.key(s));
    const missIndex = new Map<string, number>();
    const misses: (readonly string[])[] = [];
    for (const [i, key] of keys.entries()) {
      if (this.cache.has(key) || missIndex.has(key)) continue;
      if (misses.length >= this.remaining) {
        this.truncated = true;
        continue;
      }
      missIndex.set(key, misses.length);
      misses.push(states[i] as readonly string[]);
    }
    const transient = new Map<string, EvalOutcome>();
    if (misses.length > 0) {
      let outcomes: EvalOutcome[];
      this.used += misses.length;
      try {
        outcomes = await this.evaluator.evaluate(misses as PassiveNodeId[][], this.metrics);
      } catch (cause) {
        throw new OptimizerError("evaluator_failed", "The calculation engine failed", { cause });
      }
      if (outcomes.length !== misses.length) {
        throw new OptimizerError(
          "evaluator_failed",
          `Evaluator returned ${outcomes.length} outcomes for ${misses.length} states`,
        );
      }
      for (const [key, index] of missIndex) {
        const outcome = this.check(outcomes[index] as EvalOutcome);
        if (outcome.ok || !TRANSIENT_KINDS.has(outcome.error.kind)) this.cache.set(key, outcome);
        else transient.set(key, outcome);
        if (!outcome.ok) {
          this.failedCount++;
          if (this.failures.length < MAX_RECORDED_FAILURES) {
            this.failures.push({
              nodeCount: (misses[index] as readonly string[]).length,
              error: outcome.error,
            });
          }
        }
      }
    }
    return keys.map((key) => this.cache.get(key) ?? transient.get(key) ?? null);
  }

  /** A success must carry every requested metric as a finite number; otherwise it is a failure. */
  private check(outcome: EvalOutcome): EvalOutcome {
    if (!outcome.ok) return outcome;
    const missing = this.metrics.filter((m) => !Number.isFinite(outcome.metrics[m]));
    if (missing.length === 0) return outcome;
    return {
      ok: false,
      error: { kind: "missing_metric", detail: `No value for: ${missing.join(", ")}` },
    };
  }
}

export function metricsOf(outcome: EvalOutcome): Metrics | undefined {
  return outcome.ok ? outcome.metrics : undefined;
}
