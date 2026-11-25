import {
  CALC_PROTOCOL_VERSION,
  CalcMethods,
  parseCalcParams,
  parseCalcResult,
  type CalcMethodName,
  type CalcParams,
  type BuildHandle,
  type CalcResultOf,
  type DataReleaseId,
} from "@exileforge/contracts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeBuildCode, encodeBuildCode } from "./build-code.ts";
import type { PoolConfig } from "./config.ts";
import { computeDataHash } from "./data-hash.ts";
import { CalcServiceError } from "./errors.ts";
import { assertPobInstall, type PobInstall } from "./install.ts";
import type { CalcProfile } from "./profiles.ts";
import { PobWorker } from "./worker.ts";

export type PoolEvent =
  | { type: "worker-started"; slot: number; pid: number | undefined; ms: number }
  | { type: "worker-exited"; slot: number; pid: number | undefined; reason: string }
  | { type: "worker-start-failed"; slot: number; attempt: number; error: CalcServiceError }
  | { type: "worker-recycled"; slot: number; requests: number }
  | { type: "slot-disabled"; slot: number; error: CalcServiceError }
  | { type: "release-failed"; slot: number; handle: string; error: unknown };

/** Validates a worker answer the pool uses internally; a bad answer is `calc_failed`. */
function workerResult<M extends CalcMethodName>(method: M, raw: unknown): CalcResultOf<M> {
  try {
    return parseCalcResult(method, raw);
  } catch (cause) {
    throw new CalcServiceError(
      "calc_failed",
      `Calc worker returned an invalid result for ${method}`,
      cause instanceof Error && cause.cause instanceof Error ? cause.cause.message : undefined,
      { cause },
    );
  }
}

export interface CalcPoolOptions {
  install: PobInstall;
  profiles: ReadonlyMap<string, CalcProfile>;
  /** Published data release this PoB data belongs to; absent = local (`+r0`). */
  dataReleaseId?: DataReleaseId;
  size: number;
  config: Omit<PoolConfig, "size" | "maxWorkers" | "workerMemoryMb" | "$comment">;
  /** Diagnostics (worker restarts, recycling). */
  onEvent?: (event: PoolEvent) => void;
  /** Extra environment for worker processes (tests). */
  workerEnv?: Record<string, string>;
}

/** Methods this calc service version implements; the rest follow in later PRs. */
export const IMPLEMENTED_METHODS = [
  "meta.version",
  "build.load",
  "build.export",
  "build.release",
  "build.applyPatch",
  "calc.stats",
] as const satisfies readonly CalcMethodName[];

interface Slot {
  readonly index: number;
  worker: PobWorker | null;
  busy: boolean;
  requests: number;
  startFailures: number;
  disabled: boolean;
  /** Public handle -> worker-local handle. Cleared when the worker is replaced. */
  handles: Map<string, string>;
  /** Worker handles to release before the slot's next job. */
  toRelease: string[];
}

interface StoredBuild {
  readonly xml: string;
}

interface Waiter {
  readonly prefer: string | undefined;
  readonly resolve: (slot: Slot) => void;
  readonly reject: (err: CalcServiceError) => void;
}

/**
 * Supervisor for a pool of PoB workers. Serves the calc RPC contract:
 * validates params and results against `CalcMethods`, routes requests to
 * idle workers (preferring one that already has the build), restarts crashed
 * workers, kills workers that exceed the request timeout and recycles
 * workers after a configured number of requests.
 *
 * Build handles are pool-wide: the pool keeps the build XML and loads it
 * into whichever worker serves a request.
 */
export class CalcPool {
  private readonly slots: Slot[] = [];
  private readonly waiters: Waiter[] = [];
  private readonly builds = new Map<string, StoredBuild>();
  private nextHandle = 1;
  private closed = false;
  private readonly timers = new Set<NodeJS.Timeout>();
  private lastStartError: CalcServiceError | undefined;
  private metaInfo: CalcResultOf<"meta.version"> | undefined;

  private readonly opts: CalcPoolOptions;
  private readonly initDir: string;

  private constructor(opts: CalcPoolOptions, initDir: string) {
    this.opts = opts;
    this.initDir = initDir;
  }

  static async start(opts: CalcPoolOptions): Promise<CalcPool> {
    if (opts.size < 1) throw new Error("calc pool size must be at least 1");
    await assertPobInstall(opts.install);
    const dataHash = await computeDataHash(opts.install.srcDir);
    const initDir = await mkdtemp(join(tmpdir(), "exileforge-calc-"));
    const profiles = Object.fromEntries(
      [...opts.profiles.values()].map((p) => [p.id, { hash: p.hash, config: p.config }]),
    );
    await writeFile(
      join(initDir, "init.json"),
      JSON.stringify({
        protocolVersion: CALC_PROTOCOL_VERSION,
        dataReleaseId: opts.dataReleaseId ?? null,
        dataHash,
        luaGc: opts.config.luaGc,
        profiles,
      }),
    );
    const pool = new CalcPool(opts, initDir);
    for (let i = 0; i < opts.size; i++) {
      pool.slots.push({
        index: i,
        worker: null,
        busy: false,
        requests: 0,
        startFailures: 0,
        disabled: false,
        handles: new Map(),
        toRelease: [],
      });
    }
    try {
      // The first start must succeed everywhere: a broken install should fail loudly.
      await Promise.all(pool.slots.map((s) => pool.spawnInto(s)));
    } catch (err) {
      await pool.close();
      throw err;
    }
    return pool;
  }

  get size(): number {
    return this.slots.length;
  }

  /** Version info of the running PoB (from the first worker). */
  get meta(): CalcResultOf<"meta.version"> {
    if (!this.metaInfo) throw new Error("calc pool has no meta (not started)");
    return this.metaInfo;
  }

  status(): { workers: number; ready: number; busy: number; queued: number; builds: number } {
    return {
      workers: this.slots.length,
      ready: this.slots.filter((s) => s.worker?.alive).length,
      busy: this.slots.filter((s) => s.busy).length,
      queued: this.waiters.length,
      builds: this.builds.size,
    };
  }

  /** Worker process ids (diagnostics and tests). */
  workerPids(): (number | undefined)[] {
    return this.slots.map((s) => s.worker?.pid);
  }

  /** Serves one calc RPC request. Params and result are validated against the contract. */
  async request<M extends CalcMethodName>(
    method: M,
    params: CalcParams<M>,
  ): Promise<CalcResultOf<M>> {
    if (this.closed) throw new CalcServiceError("worker_crashed", "Calc pool is closed");
    if (!(method in CalcMethods)) {
      throw new CalcServiceError("unknown_method", "Unknown calc method", String(method));
    }
    let p: CalcParams<CalcMethodName>;
    try {
      p = parseCalcParams(method, params);
    } catch (cause) {
      throw new CalcServiceError(
        "invalid_params",
        `Invalid params for ${method}`,
        cause instanceof Error && cause.cause instanceof Error ? cause.cause.message : undefined,
        { cause },
      );
    }
    return workerResult(method, await this.dispatch(method, p));
  }

  private async dispatch(method: CalcMethodName, params: unknown): Promise<unknown> {
    switch (method) {
      case "meta.version":
        return this.meta;
      case "build.load":
        return this.load(params as CalcParams<"build.load">);
      case "build.export":
        return this.exportBuild(params as CalcParams<"build.export">);
      case "build.applyPatch":
        return this.applyPatch(params as CalcParams<"build.applyPatch">);
      case "build.release":
        return this.release(params as CalcParams<"build.release">);
      case "calc.stats": {
        const p = params as CalcParams<"calc.stats">;
        if (!this.opts.profiles.has(p.profile)) {
          throw new CalcServiceError("invalid_params", "Unknown calc profile", p.profile);
        }
        return this.withBuild(p.handle, (worker, wh) =>
          worker.call("calc.stats", { ...p, handle: wh }, this.opts.config.requestTimeoutMs),
        );
      }
      default:
        throw new CalcServiceError(
          "unknown_method",
          "Method not implemented by this calc service yet",
          method,
        );
    }
  }

  private async load(p: CalcParams<"build.load">): Promise<unknown> {
    const xml = p.format === "code" ? decodeBuildCode(p.payload) : p.payload;
    const handle = `b${String(this.nextHandle++)}`;
    return this.withSlot(undefined, async (slot, worker) => {
      const raw = await worker.call(
        "build.load",
        { format: "xml", payload: xml },
        this.opts.config.requestTimeoutMs,
      );
      const res = workerResult("build.load", raw);
      this.builds.set(handle, { xml });
      slot.handles.set(handle, res.handle);
      return { handle, warnings: res.warnings };
    });
  }

  private async exportBuild(p: CalcParams<"build.export">): Promise<unknown> {
    const raw = await this.withBuild(p.handle, (worker, wh) =>
      worker.call("build.export", { handle: wh, format: "xml" }, this.opts.config.requestTimeoutMs),
    );
    const res = workerResult("build.export", raw);
    return p.format === "code" ? { payload: encodeBuildCode(res.payload) } : res;
  }

  /**
   * Patches a copy of the build in a worker. The worker answers with its own
   * handle for the new state; the pool fetches that state's XML so the new
   * handle works on every worker, like a loaded build.
   */
  private async applyPatch(p: CalcParams<"build.applyPatch">): Promise<unknown> {
    const handle = `b${String(this.nextHandle++)}`;
    return this.withBuild(p.handle, async (worker, wh, slot) => {
      const timeout = this.opts.config.requestTimeoutMs;
      const res = workerResult(
        "build.applyPatch",
        await worker.call("build.applyPatch", { handle: wh, ops: p.ops }, timeout),
      );
      let exported;
      try {
        exported = workerResult(
          "build.export",
          await worker.call("build.export", { handle: res.handle, format: "xml" }, timeout),
        );
      } catch (error) {
        // The patched state is useless without its XML; do not keep it in the worker.
        await worker
          .call("build.release", { handle: res.handle }, timeout)
          .catch((releaseError: unknown) => {
            this.emit({
              type: "release-failed",
              slot: slot.index,
              handle: res.handle,
              error: releaseError,
            });
          });
        throw error;
      }
      this.builds.set(handle, { xml: exported.payload });
      slot.handles.set(handle, res.handle);
      return { handle, warnings: res.warnings };
    });
  }

  private release(p: CalcParams<"build.release">): unknown {
    if (!this.builds.delete(p.handle)) {
      throw new CalcServiceError("unknown_handle", "Unknown build handle", p.handle);
    }
    for (const slot of this.slots) {
      const wh = slot.handles.get(p.handle);
      if (wh !== undefined) {
        slot.handles.delete(p.handle);
        slot.toRelease.push(wh);
      }
    }
    return {};
  }

  /** Runs fn on a worker that has the build loaded (loading it there first if needed). */
  private withBuild(
    handle: BuildHandle,
    fn: (worker: PobWorker, workerHandle: string, slot: Slot) => Promise<unknown>,
  ): Promise<unknown> {
    const stored = this.builds.get(handle);
    if (!stored) throw new CalcServiceError("unknown_handle", "Unknown build handle", handle);
    return this.withSlot(handle, async (slot, worker) => {
      let wh = slot.handles.get(handle);
      if (wh === undefined) {
        const raw = await worker.call(
          "build.load",
          { format: "xml", payload: stored.xml },
          this.opts.config.requestTimeoutMs,
        );
        wh = workerResult("build.load", raw).handle;
        if (!this.builds.has(handle)) {
          // Released while it was loading: free it in the worker, too.
          slot.toRelease.push(wh);
          throw new CalcServiceError("unknown_handle", "Build was released", handle);
        }
        slot.handles.set(handle, wh);
      }
      return fn(worker, wh, slot);
    });
  }

  private async withSlot<T>(
    prefer: string | undefined,
    fn: (slot: Slot, worker: PobWorker) => Promise<T>,
  ): Promise<T> {
    const slot = await this.acquire(prefer);
    try {
      const worker = slot.worker;
      if (!worker?.alive) {
        throw new CalcServiceError("worker_crashed", "Calc worker stopped before the request");
      }
      await this.flushReleases(slot, worker);
      return await fn(slot, worker);
    } finally {
      this.releaseSlot(slot);
    }
  }

  private async flushReleases(slot: Slot, worker: PobWorker): Promise<void> {
    for (const wh of slot.toRelease.splice(0)) {
      try {
        await worker.call("build.release", { handle: wh }, this.opts.config.requestTimeoutMs);
      } catch (error) {
        // The build is gone from the pool either way; a worker that lost it
        // already is fine, anything else is reported.
        this.emit({ type: "release-failed", slot: slot.index, handle: wh, error });
        if (!worker.alive) throw error;
      }
    }
  }

  private ready(slot: Slot): boolean {
    return !slot.busy && !slot.disabled && slot.worker !== null && slot.worker.alive;
  }

  private acquire(prefer: string | undefined): Promise<Slot> {
    if (this.closed) {
      return Promise.reject(new CalcServiceError("worker_crashed", "Calc pool is closed"));
    }
    const slot = this.pickIdle(prefer);
    if (slot) {
      slot.busy = true;
      return Promise.resolve(slot);
    }
    if (this.slots.every((s) => s.disabled)) {
      return Promise.reject(this.noWorkersError());
    }
    return new Promise((resolve, reject) => this.waiters.push({ prefer, resolve, reject }));
  }

  private pickIdle(prefer: string | undefined): Slot | undefined {
    const idle = this.slots.filter((s) => this.ready(s));
    return (prefer !== undefined ? idle.find((s) => s.handles.has(prefer)) : undefined) ?? idle[0];
  }

  private releaseSlot(slot: Slot): void {
    slot.busy = false;
    // A crashed worker's slot was reset already; its replacement starts at 0.
    if (slot.worker?.alive) slot.requests++;
    if (slot.worker?.alive && slot.requests >= this.opts.config.recycleAfterRequests) {
      this.emit({ type: "worker-recycled", slot: slot.index, requests: slot.requests });
      const old = slot.worker;
      this.resetSlot(slot);
      void old.stop().finally(() => this.respawn(slot));
      return;
    }
    this.serveWaiters();
  }

  private serveWaiters(): void {
    // Oldest waiter first; it gets the idle worker that already has its build, if any.
    for (let waiter = this.waiters[0]; waiter; waiter = this.waiters[0]) {
      const slot = this.pickIdle(waiter.prefer);
      if (!slot) return;
      this.waiters.shift();
      slot.busy = true;
      waiter.resolve(slot);
    }
  }

  private resetSlot(slot: Slot): void {
    slot.worker = null;
    slot.requests = 0;
    slot.handles = new Map();
    slot.toRelease = [];
  }

  private async spawnInto(slot: Slot): Promise<void> {
    const started = Date.now();
    const worker = await PobWorker.start({
      install: this.opts.install,
      initPath: join(this.initDir, "init.json"),
      startTimeoutMs: this.opts.config.startTimeoutMs,
      stopGraceMs: this.opts.config.stopGraceMs,
      ...(this.opts.workerEnv ? { env: this.opts.workerEnv } : {}),
    });
    if (this.closed) {
      await worker.stop();
      return;
    }
    const known = this.metaInfo;
    const meta = worker.meta;
    if (
      known &&
      meta &&
      (meta.pobVersion !== known.pobVersion ||
        meta.dataHash !== known.dataHash ||
        meta.dataReleaseId !== known.dataReleaseId)
    ) {
      // E.g. the PoB install was replaced on disk: one pool serves one version.
      await worker.stop();
      throw new CalcServiceError(
        "protocol_mismatch",
        "New calc worker runs another PoB version or data than the pool",
        `${meta.pobVersion}/${meta.dataReleaseId} instead of ${known.pobVersion}/${known.dataReleaseId}`,
      );
    }
    this.metaInfo ??= meta;
    slot.worker = worker;
    slot.startFailures = 0;
    this.emit({
      type: "worker-started",
      slot: slot.index,
      pid: worker.pid,
      ms: Date.now() - started,
    });
    worker.onExit((reason) => this.onWorkerExit(slot, worker, reason));
    this.serveWaiters();
  }

  private onWorkerExit(slot: Slot, worker: PobWorker, reason: string): void {
    this.emit({ type: "worker-exited", slot: slot.index, pid: worker.pid, reason });
    if (slot.worker !== worker || this.closed) return; // recycled or shutting down
    this.resetSlot(slot);
    this.respawn(slot);
  }

  /** Starts a new worker in the slot, with backoff; gives the slot up after maxStartFailures. */
  private respawn(slot: Slot): void {
    if (this.closed) return;
    this.spawnInto(slot).catch((err: unknown) => {
      if (this.closed) return;
      const error =
        err instanceof CalcServiceError
          ? err
          : new CalcServiceError("worker_crashed", "Calc worker failed to start", undefined, {
              cause: err,
            });
      slot.startFailures++;
      this.lastStartError = error;
      this.emit({
        type: "worker-start-failed",
        slot: slot.index,
        attempt: slot.startFailures,
        error,
      });
      if (slot.startFailures >= this.opts.config.maxStartFailures) {
        slot.disabled = true;
        this.emit({ type: "slot-disabled", slot: slot.index, error });
        if (this.slots.every((s) => s.disabled)) {
          for (const w of this.waiters.splice(0)) w.reject(this.noWorkersError());
        }
        return;
      }
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.respawn(slot);
      }, this.opts.config.restartBackoffMs * slot.startFailures);
      this.timers.add(timer);
    });
  }

  private noWorkersError(): CalcServiceError {
    return new CalcServiceError(
      "worker_crashed",
      "No calc worker could be started",
      this.lastStartError?.message,
      { cause: this.lastStartError },
    );
  }

  private emit(event: PoolEvent): void {
    if (this.opts.onEvent) {
      this.opts.onEvent(event);
    } else if (event.type === "release-failed" || event.type === "slot-disabled") {
      // Without a listener these would go unnoticed.
      console.warn(`[calc] ${event.type} in slot ${String(event.slot)}`, event);
    }
  }

  /** Stops all workers, rejects queued requests and removes temporary files. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const w of this.waiters.splice(0)) {
      w.reject(new CalcServiceError("worker_crashed", "Calc pool is closed"));
    }
    await Promise.all(this.slots.map((s) => s.worker?.stop()));
    await rm(this.initDir, { recursive: true, force: true });
  }
}
