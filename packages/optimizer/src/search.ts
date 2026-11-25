import { type OptimizerConfig } from "./config.ts";
import type { Evaluations } from "./evaluations.ts";
import type { TreeGraph } from "./graph.ts";
import type { Scorer } from "./score.ts";
import type { EvalSuccess, RefineStop, StopReason } from "./types.ts";

export interface SearchConstraints {
  /** Nodes that may never be allocated. */
  blocked: ReadonlySet<string>;
  /** Nodes that may not be removed. */
  locked: ReadonlySet<string>;
  /** Nodes valued first when nothing is measured yet. */
  priority: ReadonlySet<string>;
}

export interface Prior {
  /** Score gain of allocating the node with its path, as measured. */
  gain: number;
  cost: number;
}

interface Scored {
  score: number;
  outcome: EvalSuccess;
}

/** Greedy growth and swap refinement over a tree state; all values come from `Evaluations`. */
export class TreeSearch {
  /** Allocated main-tree nodes in allocation order (class start excluded). */
  order: string[];
  readonly priors = new Map<string, Prior>();
  /** Targets the engine could not calculate; not offered again. */
  private readonly failedTargets = new Set<string>();

  constructor(
    private readonly graph: TreeGraph,
    private readonly evals: Evaluations,
    private readonly scorer: Scorer,
    private readonly cfg: OptimizerConfig,
    private readonly constraints: SearchConstraints,
    initial: readonly string[],
  ) {
    this.order = [...initial];
  }

  get nodes(): ReadonlySet<string> {
    return new Set(this.order);
  }

  async score(state: readonly string[]): Promise<Scored | undefined> {
    const [outcome] = await this.evals.evaluate([state]);
    if (!outcome?.ok) return undefined;
    return { score: this.scorer.score(outcome.metrics), outcome };
  }

  private sources(): Set<string> {
    return new Set([this.graph.start, ...this.order]);
  }

  private ratio(id: string): number | undefined {
    const prior = this.priors.get(id);
    return prior === undefined ? undefined : prior.gain / prior.cost;
  }

  /**
   * Allocates nodes until `budget` points are used. `eligible` limits which
   * nodes may be added (progression: only nodes of the target tree).
   */
  async grow(
    budget: number,
    options: { eligible?: ReadonlySet<string>; spendAll: boolean },
  ): Promise<StopReason> {
    const blocked = new Set(this.constraints.blocked);
    if (options.eligible !== undefined) {
      for (const id of this.graph.ids()) if (!options.eligible.has(id)) blocked.add(id);
    }
    let current = await this.score(this.order);
    if (current === undefined) return this.failStop();
    while (this.order.length < budget) {
      const remaining = budget - this.order.length;
      const reached = this.graph.search(
        this.sources(),
        blocked,
        Math.min(remaining, this.cfg.maxPathCost),
      );
      if (reached.size === 0) {
        return options.eligible !== undefined && this.order.length >= options.eligible.size
          ? "target_complete"
          : "no_candidates";
      }
      const failedBefore = this.failedTargets.size;
      const targets = this.rank(reached);
      const paths = targets.map((t) => this.graph.pathTo(t, reached));
      const outcomes = await this.evals.evaluate(paths.map((p) => [...this.order, ...p]));
      let best: { index: number; gain: number; ratio: number } | undefined;
      for (const [i, outcome] of outcomes.entries()) {
        if (!outcome) continue;
        if (!outcome.ok) {
          this.failedTargets.add(targets[i] as string);
          continue;
        }
        const gain = this.scorer.score(outcome.metrics) - current.score;
        const cost = (paths[i] as string[]).length;
        this.priors.set(targets[i] as string, { gain, cost });
        // Per point for gains; for losses the smaller loss counts, not the longer path.
        const ratio = gain > 0 ? gain / cost : gain;
        if (
          best === undefined ||
          ratio > best.ratio ||
          (ratio === best.ratio && cost < (paths[best.index] as string[]).length)
        ) {
          best = { index: i, gain, ratio };
        }
      }
      if (best === undefined && failedBefore < this.failedTargets.size) continue;
      if (best === undefined) {
        return this.evals.remaining <= 0 ? "evaluation_budget" : "no_candidates";
      }
      if (best.gain <= 0 && !options.spendAll) return "no_gain";
      this.order.push(...(paths[best.index] as string[]));
      current = await this.score(this.order);
      if (current === undefined) return this.failStop();
    }
    return "budget_spent";
  }

  private failStop(): "evaluation_budget" | "evaluation_failed" {
    return this.evals.remaining <= 0 ? "evaluation_budget" : "evaluation_failed";
  }

  /** Orders targets: some unmeasured ones (priority first, nearest first), the rest by measured value per point. */
  private rank(reached: ReadonlyMap<string, { distance: number }>): string[] {
    const unknown: string[] = [];
    const known: string[] = [];
    for (const id of reached.keys()) {
      if (this.failedTargets.has(id)) continue;
      (this.priors.has(id) ? known : unknown).push(id);
    }
    const dist = (id: string): number => reached.get(id)?.distance ?? 0;
    unknown.sort(
      (a, b) =>
        Number(this.constraints.priority.has(b)) - Number(this.constraints.priority.has(a)) ||
        dist(a) - dist(b) ||
        a.localeCompare(b),
    );
    known.sort(
      (a, b) =>
        (this.ratio(b) as number) - (this.ratio(a) as number) ||
        dist(a) - dist(b) ||
        a.localeCompare(b),
    );
    const slots = this.cfg.candidatesPerRound;
    let exploring = Math.min(unknown.length, Math.ceil(slots * this.cfg.explorationShare));
    if (known.length < slots - exploring)
      exploring = Math.min(unknown.length, slots - known.length);
    return [...unknown.slice(0, exploring), ...known.slice(0, slots - exploring)];
  }

  /** Single-node swaps (remove a leaf, add a neighbor) while the score improves. */
  async refine(): Promise<RefineStop> {
    let current = await this.score(this.order);
    if (current === undefined) return this.failStop();
    for (let round = 0; round < this.cfg.maxRefineRounds; round++) {
      const state = this.nodes;
      const leaves = this.order
        .filter((id) => !this.constraints.locked.has(id))
        .filter((id) => {
          const rest = new Set(state);
          rest.delete(id);
          return this.graph.isConnected(rest);
        })
        .sort(
          (a, b) =>
            (this.ratio(a) ?? Number.NEGATIVE_INFINITY) -
              (this.ratio(b) ?? Number.NEGATIVE_INFINITY) || a.localeCompare(b),
        );
      const reached = this.graph.search(this.sources(), this.constraints.blocked, 1);
      const adds = this.rank(reached).slice(0, this.cfg.swapAddsPerLeaf);
      const swaps: { remove: string; add: string; state: string[] }[] = [];
      for (const remove of leaves) {
        for (const add of adds) {
          const next = this.order.filter((id) => id !== remove).concat(add);
          if (!this.graph.isConnected(new Set(next))) continue;
          swaps.push({ remove, add, state: next });
          if (swaps.length >= this.cfg.maxSwapCandidates) break;
        }
        if (swaps.length >= this.cfg.maxSwapCandidates) break;
      }
      if (swaps.length === 0) return "converged";
      const outcomes = await this.evals.evaluate(swaps.map((s) => s.state));
      let best: { index: number; score: number } | undefined;
      for (const [i, outcome] of outcomes.entries()) {
        if (!outcome?.ok) continue;
        const score = this.scorer.score(outcome.metrics);
        if (score > current.score + this.cfg.minImprovement && (!best || score > best.score)) {
          best = { index: i, score };
        }
      }
      if (best === undefined) return this.evals.truncated ? "evaluation_budget" : "converged";
      this.order = (swaps[best.index] as { state: string[] }).state;
      current = await this.score(this.order);
      if (current === undefined) return this.failStop();
    }
    return "max_rounds";
  }
}
