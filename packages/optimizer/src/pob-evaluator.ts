import type {
  BuildHandle,
  CalcMethodName,
  CalcParams,
  CalcProfileId,
  CalcResult,
  CalcResultOf,
  ConfigOverrides,
  PassiveNodeId,
  PatchOp,
} from "@astrolabe/contracts";
import { OptimizerError } from "./errors.ts";
import type { EvalOutcome, Metrics, NodePowerEntry, TreeEvaluator } from "./types.ts";

/** What the evaluator needs from the PoB worker pool (`CalcPool` from apps/calc fits). */
export interface CalcRequester {
  request<M extends CalcMethodName>(method: M, params: CalcParams<M>): Promise<CalcResultOf<M>>;
}

export interface PobTreeEvaluatorOptions {
  pool: CalcRequester;
  /** Loaded build whose tree is `baseAllocated`; all candidates are patches of it. */
  handle: BuildHandle;
  profile: CalcProfileId;
  /** Main-tree allocation of the loaded build (class start excluded). */
  baseAllocated: readonly PassiveNodeId[];
  /** Weapon set for new allocations; PoB's default if absent. */
  weaponSet?: number;
  mainSkill?: string;
  /** The player's overrides of the calc profile; sent with every calculation. */
  overrides?: ConfigOverrides;
}

function isUnknownMethod(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { kind?: unknown }).kind === "unknown_method"
  );
}

/** PoB patched the tree differently than asked; the numbers would describe another state. */
export class TreePatchDivergedError extends Error {
  constructor(warnings: readonly string[]) {
    super(`PoB did not apply the tree patch as planned: ${warnings.join("; ")}`);
    this.name = "TreePatchDivergedError";
  }
}

/**
 * TreeEvaluator on the calc service: each state becomes allocate/deallocate
 * patches of the loaded build and runs through `calc.evalBatch`, which
 * returns the deltas against the build; absolute values are base + delta.
 * Loading is the expensive part of PoB, so nothing here reloads the build.
 */
export function createPobTreeEvaluator(options: PobTreeEvaluatorOptions): TreeEvaluator & {
  /** Applies the state (also used as `confirm` by the optimizer), checks PoB took it as given and returns the full result for `calcRef`s. */
  confirmResult(allocated: readonly PassiveNodeId[]): Promise<CalcResult>;
} {
  const { pool, handle, profile } = options;
  const overrides =
    options.overrides === undefined || Object.keys(options.overrides).length === 0
      ? {}
      : { overrides: options.overrides };
  const baseSet = new Set<string>(options.baseAllocated);
  let baseStats: Promise<CalcResult> | undefined;

  const getBase = (): Promise<CalcResult> => {
    baseStats ??= pool.request("calc.stats", {
      handle,
      profile,
      ...overrides,
      ...(options.mainSkill === undefined ? {} : { mainSkill: options.mainSkill }),
    });
    return baseStats;
  };

  function opsFor(from: ReadonlySet<string>, state: readonly string[]): PatchOp[] {
    const wanted = new Set(state);
    const remove = [...from].filter((id) => !wanted.has(id));
    const add = state.filter((id) => !from.has(id));
    const ops: PatchOp[] = [];
    if (remove.length > 0) {
      ops.push({ op: "deallocateNodes", nodeIds: remove as PassiveNodeId[] });
    }
    if (add.length > 0) {
      ops.push({
        op: "allocateNodes",
        nodeIds: add as PassiveNodeId[],
        ...(options.weaponSet === undefined ? {} : { weaponSet: options.weaponSet }),
      });
    }
    return ops;
  }

  function pick(stats: Metrics, metrics: readonly string[]): Metrics | undefined {
    const out: Record<string, number> = {};
    for (const m of metrics) {
      const v = stats[m];
      if (v === undefined) return undefined;
      out[m] = v;
    }
    return out;
  }

  async function evaluate(
    states: readonly (readonly PassiveNodeId[])[],
    metrics: readonly string[],
  ): Promise<EvalOutcome[]> {
    const outcomes: EvalOutcome[] = new Array<EvalOutcome>(states.length);
    const candidates: { key: string; ops: PatchOp[] }[] = [];
    let base: CalcResult | undefined;
    for (const [i, state] of states.entries()) {
      const ops = opsFor(baseSet, state);
      if (ops.length === 0) {
        base ??= await getBase();
        const m = pick(base.stats, metrics);
        outcomes[i] = m
          ? { ok: true, metrics: m, calcId: base.calcId }
          : { ok: false, error: { kind: "missing_metric", detail: "Base result lacks a metric" } };
      } else {
        candidates.push({ key: String(i), ops });
      }
    }
    if (candidates.length > 0) {
      const batch = await pool.request("calc.evalBatch", {
        handle,
        profile,
        ...overrides,
        metrics: [...metrics],
        candidates,
      });
      for (const result of batch.results) {
        const i = Number(result.key);
        if (!result.ok) {
          outcomes[i] = {
            ok: false,
            error: {
              kind: result.error.kind,
              ...(result.error.detail === undefined ? {} : { detail: result.error.detail }),
            },
          };
          continue;
        }
        const absolute: Record<string, number> = {};
        let complete = true;
        for (const m of metrics) {
          const baseValue = batch.base.stats[m];
          const delta = result.deltas[m];
          if (baseValue === undefined || delta === undefined) {
            complete = false;
            break;
          }
          absolute[m] = baseValue + delta;
        }
        outcomes[i] = complete
          ? { ok: true, metrics: absolute, calcId: result.calcId }
          : { ok: false, error: { kind: "missing_metric", detail: "Batch result lacks a metric" } };
      }
    }
    for (const [i, outcome] of outcomes.entries()) {
      if (outcome === undefined) {
        throw new OptimizerError(
          "evaluator_failed",
          `Calc service returned no result for state ${i}`,
        );
      }
    }
    return outcomes;
  }

  /** Release must not hide the original error; a leaked temp handle is reported on stderr. */
  async function release(target: BuildHandle): Promise<void> {
    try {
      await pool.request("build.release", { handle: target });
    } catch (error) {
      console.error(`Could not release temporary build handle ${target}`, error);
    }
  }

  async function nodePower(
    base: readonly PassiveNodeId[],
    candidates: readonly PassiveNodeId[] | undefined,
    metrics: readonly string[],
  ): Promise<NodePowerEntry[] | undefined> {
    let target = handle;
    let temporary = false;
    try {
      const ops = opsFor(baseSet, base);
      if (ops.length > 0) {
        const patched = await pool.request("build.applyPatch", { handle, ops });
        target = patched.handle;
        temporary = true;
        if (patched.warnings.length > 0) throw new TreePatchDivergedError(patched.warnings);
      }
      const result = await pool.request("calc.nodePower", {
        handle: target,
        profile,
        ...overrides,
        metrics: [...metrics],
        ...(candidates === undefined ? {} : { candidates: [...candidates] }),
      });
      return result.results.map((r) => ({
        nodeId: r.nodeId,
        deltas: r.deltas,
        pathCost: r.pathCost,
      }));
    } catch (error) {
      if (isUnknownMethod(error)) return undefined;
      throw error;
    } finally {
      if (temporary) await release(target);
    }
  }

  async function confirmResult(allocated: readonly PassiveNodeId[]): Promise<CalcResult> {
    const ops = opsFor(baseSet, allocated);
    let target = handle;
    let temporary = false;
    try {
      if (ops.length > 0) {
        const patched = await pool.request("build.applyPatch", { handle, ops });
        target = patched.handle;
        temporary = true;
        if (patched.warnings.length > 0) throw new TreePatchDivergedError(patched.warnings);
      }
      return await pool.request("calc.stats", {
        handle: target,
        profile,
        ...overrides,
        ...(options.mainSkill === undefined ? {} : { mainSkill: options.mainSkill }),
      });
    } finally {
      if (temporary) await release(target);
    }
  }

  async function confirmOutcome(
    allocated: readonly PassiveNodeId[],
    metrics: readonly string[],
  ): Promise<EvalOutcome> {
    const full = await confirmResult(allocated);
    const m = pick(full.stats, metrics);
    return m
      ? { ok: true, metrics: m, calcId: full.calcId }
      : { ok: false, error: { kind: "missing_metric", detail: "Confirmed result lacks a metric" } };
  }

  return { evaluate, nodePower, confirm: confirmOutcome, confirmResult };
}
