import { diffBuildState, PatchPlanError, type ItemTextRenderer } from "@exileforge/calc-client";
import type { BuildState, CalcOutcome } from "@exileforge/contracts/build";
import type {
  BuildFormat,
  BuildHandle,
  CalcMethodName,
  CalcParams,
  CalcResult,
  CalcResultOf,
} from "@exileforge/contracts/calc";
import type { ConfigOverrides } from "@exileforge/contracts/calc";
import type { CalcId, CalcProfileId } from "@exileforge/contracts/common";
import type { Logger } from "../logger.js";
import type { CalcPort } from "../ports/calc.js";

/** What the adapter needs from the PoB worker pool (`CalcPool` from apps/calc fits). */
export interface CalcRequester {
  request<M extends CalcMethodName>(method: M, params: CalcParams<M>): Promise<CalcResultOf<M>>;
}

/** A Path of Building build the worker can load, plus the BuildState it contains. */
export interface BaseBuild {
  format: BuildFormat;
  payload: string;
  /** The state `payload` describes; patches are computed from it to the wanted state. */
  state: BuildState;
}

/**
 * Where the starting build of a calculation comes from (a template per class,
 * or an import). Decided outside the adapter; see packages/calc-client README.
 */
export interface BaseBuildProvider {
  baseFor(state: BuildState): Promise<BaseBuild>;
}

export interface PobCalcOptions {
  pool: CalcRequester;
  bases: BaseBuildProvider;
  /** Needed once a state differs from its base in an item; catalog data lives with the caller. */
  renderItem?: ItemTextRenderer;
  logger: Logger;
}

/** PoB applied the patch only in part; a result would describe another build than asked for. */
class PatchDivergedError extends Error {
  readonly kind = "patch_diverged";
  constructor(warnings: readonly string[]) {
    super(`PoB did not apply the patch as planned: ${warnings.join("; ")}`);
  }
}

/**
 * CalcPort on the PoB worker pool: loads the base build, patches it to the
 * wanted state and reads `calc.stats` per profile. Every failure becomes a
 * `failed` outcome with its cause; there is no zero or stale value.
 */
export class PobCalc implements CalcPort {
  readonly engine = "pob" as const;
  private closed = false;
  private readonly results = new Map<CalcId, CalcResult>();
  private readonly baseHandles = new Map<string, Promise<BuildHandle>>();

  constructor(private readonly options: PobCalcOptions) {}

  async calculate(input: {
    state: BuildState;
    profiles: readonly CalcProfileId[];
    overrides?: ConfigOverrides;
  }): Promise<Record<CalcProfileId, CalcOutcome>> {
    if (this.closed) throw new Error("PobCalc is closed");
    const outcomes: Record<CalcProfileId, CalcOutcome> = {};
    // The player's overrides win over what the state itself carries.
    const overrides = { ...input.state.config, ...input.overrides };
    let prepared: { handle: BuildHandle; owned: boolean } | { error: CalcOutcome };
    try {
      prepared = await this.prepare(input.state);
    } catch (error) {
      prepared = { error: this.failure(error) };
    }
    try {
      for (const profile of input.profiles) {
        if ("error" in prepared) {
          outcomes[profile] = prepared.error;
          continue;
        }
        try {
          const result = await this.options.pool.request("calc.stats", {
            handle: prepared.handle,
            profile,
            ...(Object.keys(overrides).length === 0 ? {} : { overrides }),
          });
          this.results.set(result.calcId, result);
          outcomes[profile] = { status: "ok", calcId: result.calcId };
        } catch (error) {
          outcomes[profile] = this.failure(error);
        }
      }
    } finally {
      if (!("error" in prepared) && prepared.owned) await this.release(prepared.handle);
    }
    return outcomes;
  }

  async getResult(calcId: CalcId): Promise<CalcResult | undefined> {
    return this.results.get(calcId);
  }

  /**
   * Runs `fn` with a PoB handle of exactly `state` (base build plus patch) and
   * releases it afterwards. For work that needs many calculations on one
   * build, e.g. the tree optimizer.
   */
  async withBuild<T>(state: BuildState, fn: (handle: BuildHandle) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error("PobCalc is closed");
    const prepared = await this.prepare(state);
    try {
      return await fn(prepared.handle);
    } finally {
      if (prepared.owned) await this.release(prepared.handle);
    }
  }

  /** Frees the cached base handles; call when the server shuts down. */
  async close(): Promise<void> {
    this.closed = true;
    const handles = await Promise.allSettled([...this.baseHandles.values()]);
    this.baseHandles.clear();
    for (const h of handles) if (h.status === "fulfilled") await this.release(h.value);
  }

  private async prepare(state: BuildState): Promise<{ handle: BuildHandle; owned: boolean }> {
    const base = await this.options.bases.baseFor(state);
    const baseHandle = await this.loadBase(base);
    const ops = diffBuildState(base.state, state, {
      ...(this.options.renderItem === undefined ? {} : { renderItem: this.options.renderItem }),
    });
    if (ops.length === 0) return { handle: baseHandle, owned: false };
    const patched = await this.options.pool.request("build.applyPatch", {
      handle: baseHandle,
      ops,
    });
    if (patched.warnings.length > 0) {
      // PoB dropped or changed something: the calculated build is not the wanted one.
      await this.release(patched.handle);
      throw new PatchDivergedError(patched.warnings);
    }
    return { handle: patched.handle, owned: true };
  }

  private loadBase(base: BaseBuild): Promise<BuildHandle> {
    const key = `${base.format}:${base.payload}`;
    let handle = this.baseHandles.get(key);
    if (handle === undefined) {
      handle = this.options.pool
        .request("build.load", { format: base.format, payload: base.payload })
        .then((loaded) => loaded.handle);
      this.baseHandles.set(key, handle);
      // A failed load must not stay cached.
      handle.catch(() => this.baseHandles.delete(key));
    }
    return handle;
  }

  private async release(handle: BuildHandle): Promise<void> {
    try {
      await this.options.pool.request("build.release", { handle });
    } catch (error) {
      this.options.logger.error("could not release a PoB build handle", { error });
    }
  }

  private failure(error: unknown): CalcOutcome {
    const message = error instanceof Error ? error.message : String(error);
    const kind = (error as { kind?: unknown } | null)?.kind;
    const code =
      error instanceof PatchPlanError
        ? "patch_plan"
        : typeof kind === "string"
          ? kind
          : "calc_failed";
    this.options.logger.error("calculation failed", { code, error });
    return { status: "failed", error: { code, message: message || "Calculation failed" } };
  }
}
