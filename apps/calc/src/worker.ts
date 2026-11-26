import {
  CALC_PROTOCOL_VERSION,
  CalcResponse,
  parseCalcResult,
  type CalcMethodName,
  type CalcResultOf,
} from "@astrolabe/contracts";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { CalcServiceError } from "./errors.ts";
import { type PobInstall, workerLuaDir, workerLuaOf } from "./install.ts";

/** Prefix of every response line; PoB itself may print to stdout too. */
export const RESPONSE_MARKER = "@@ASTROLABE_RPC@@";
/** Lines of PoB output kept for error messages. */
const LOG_TAIL_LINES = 40;
/** Longest stdout line accepted; a build export is at most a few MB. */
const MAX_LINE_CHARS = 64 * 1024 * 1024;

export interface WorkerOptions {
  install: PobInstall;
  /** init.json written by the pool (data release, data hash, profiles). */
  initPath: string;
  startTimeoutMs: number;
  stopGraceMs: number;
  /** Extra environment variables (tests use this to steer a fake worker). */
  env?: Record<string, string>;
}

interface Pending {
  id: number;
  method: string;
  resolve: (value: unknown) => void;
  reject: (err: CalcServiceError) => void;
  timer: NodeJS.Timeout;
}

type WorkerMeta = CalcResultOf<"meta.version">;

/** Contract methods plus the worker-internal ones the supervisor builds its own methods from. */
export type WorkerMethod = CalcMethodName | "tree.reachable" | "build.template";

/**
 * One LuaJIT process running PoB. Strictly one request at a time: PoB has a
 * single build object, so the pool never sends a second request before the
 * first is answered.
 */
export class PobWorker {
  readonly pid: number | undefined;
  private readonly child: ChildProcessWithoutNullStreams;
  private pending: Pending | null = null;
  private nextId = 1;
  private exited = false;
  private stopping = false;
  private stdoutBuf = "";
  private stderrBuf = "";
  private readonly tail: string[] = [];
  private readonly exitListeners: ((reason: string) => void)[] = [];
  private exitReason = "";
  meta: WorkerMeta | undefined;

  private readonly opts: WorkerOptions;

  private constructor(opts: WorkerOptions) {
    this.opts = opts;
    const { install } = opts;
    const env: NodeJS.ProcessEnv = { ...process.env, ...opts.env };
    if (install.cpath) env.LUA_CPATH = `${install.cpath};${env.LUA_CPATH ?? ";;"}`;
    this.child = spawn(
      install.luajit,
      [workerLuaOf(install), workerLuaDir(install), opts.initPath],
      { cwd: install.srcDir, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    this.pid = this.child.pid;
    this.child.stdout.setEncoding("utf8").on("data", (d: string) => this.onStdout(d));
    this.child.stderr.setEncoding("utf8").on("data", (d: string) => this.onStderr(d));
    // A write to a dead worker raises EPIPE here; the exit handler reports it.
    this.child.stdin.on("error", (err) => {
      // EPIPE: the worker is gone or going; do not wait for the request timeout.
      this.log(`stdin: ${err.message}`);
      this.failPending(
        new CalcServiceError(
          "worker_crashed",
          "Calc worker stopped reading requests",
          err.message,
          {
            cause: err,
          },
        ),
      );
      this.kill();
    });
    this.child.on("error", (err) => {
      // Without a pid the process never started; otherwise (e.g. a failed
      // kill) it may still run, and `close` reports its end.
      if (this.child.pid === undefined)
        this.handleExit(`cannot run ${install.luajit}: ${err.message}`);
      else this.log(`process error: ${err.message}`);
    });
    // `close`, not `exit`: it fires after stdout/stderr are drained, so a last
    // response or error line written just before exiting is not lost.
    this.child.on("close", (code, signal) =>
      this.handleExit(signal ? `killed by ${signal}` : `exit code ${String(code)}`),
    );
  }

  /** Starts a worker and waits until PoB has booted and the protocol matches. */
  static async start(opts: WorkerOptions): Promise<PobWorker> {
    const worker = new PobWorker(opts);
    try {
      const raw = await worker.call("meta.version", {}, opts.startTimeoutMs);
      const meta = parseCalcResult("meta.version", raw);
      if (meta.protocolVersion !== CALC_PROTOCOL_VERSION) {
        throw new CalcServiceError(
          "protocol_mismatch",
          "Calc worker speaks another protocol version",
          `worker ${String(meta.protocolVersion)}, supervisor ${String(CALC_PROTOCOL_VERSION)}`,
        );
      }
      worker.meta = meta;
      return worker;
    } catch (err) {
      await worker.stop();
      throw err instanceof CalcServiceError
        ? err
        : new CalcServiceError(
            "worker_crashed",
            "Calc worker sent an invalid start reply",
            undefined,
            {
              cause: err,
            },
          );
    }
  }

  get alive(): boolean {
    return !this.exited && !this.stopping;
  }

  get busy(): boolean {
    return this.pending !== null;
  }

  /** Last lines PoB printed, for error messages. */
  logTail(): string {
    return this.tail.join("\n");
  }

  /** Calls listener once the process has exited (immediately if it already has). */
  onExit(listener: (reason: string) => void): void {
    if (this.exited) listener(this.exitReason);
    else this.exitListeners.push(listener);
  }

  private handleExit(arg: string): void {
    if (this.exited) return;
    // Keep a last line without trailing newline in the tail.
    if (this.stderrBuf) this.log(this.stderrBuf);
    if (this.stdoutBuf) this.log(this.stdoutBuf);
    this.stderrBuf = "";
    this.stdoutBuf = "";
    this.exited = true;
    this.exitReason = arg;
    this.failPending(
      new CalcServiceError(
        "worker_crashed",
        "Calc worker stopped",
        `${arg}${this.tail.length ? `\n${this.logTail()}` : ""}`,
      ),
    );
    for (const l of this.exitListeners.splice(0)) l(arg);
  }

  /** Sends one request and resolves with the raw `result` (validated by the caller). */
  call(method: WorkerMethod, params: unknown, timeoutMs: number): Promise<unknown> {
    if (!this.alive) {
      return Promise.reject(
        new CalcServiceError("worker_crashed", "Calc worker is not running", this.exitReason),
      );
    }
    if (this.pending) {
      return Promise.reject(new Error(`calc worker ${String(this.pid)} is busy (pool bug)`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // PoB is stuck in a calculation; only killing the process frees it.
        this.failPending(
          new CalcServiceError(
            "timeout",
            "Path of Building did not answer in time",
            `${method} after ${String(timeoutMs)} ms`,
          ),
        );
        this.kill();
      }, timeoutMs);
      this.pending = { id, method, resolve, reject, timer };
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  /** Closes stdin (the worker exits its loop) and kills it after the grace period. */
  async stop(): Promise<void> {
    if (this.exited) return;
    this.stopping = true;
    const exited = new Promise<void>((resolve) => this.onExit(() => resolve()));
    this.child.stdin.end();
    const timer = setTimeout(() => this.kill(), this.opts.stopGraceMs);
    await exited;
    clearTimeout(timer);
  }

  kill(): void {
    if (this.exited) return;
    // No further requests: the exit event follows asynchronously.
    this.stopping = true;
    this.child.kill("SIGKILL");
  }

  private log(line: string): void {
    this.tail.push(line);
    if (this.tail.length > LOG_TAIL_LINES) this.tail.shift();
  }

  private failPending(err: CalcServiceError): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    p.reject(err);
  }

  private onStderr(chunk: string): void {
    this.stderrBuf += chunk;
    let nl: number;
    while ((nl = this.stderrBuf.indexOf("\n")) >= 0) {
      this.log(this.stderrBuf.slice(0, nl).replace(/\r$/, ""));
      this.stderrBuf = this.stderrBuf.slice(nl + 1);
    }
  }

  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk;
    if (this.stdoutBuf.length > MAX_LINE_CHARS) {
      this.protocolError(`stdout line longer than ${String(MAX_LINE_CHARS)} characters`);
      this.stdoutBuf = "";
      return;
    }
    let nl: number;
    while ((nl = this.stdoutBuf.indexOf("\n")) >= 0) {
      const line = this.stdoutBuf.slice(0, nl).replace(/\r$/, "");
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      // PoB may have written to stdout without a newline before the response.
      const at = line.indexOf(RESPONSE_MARKER);
      if (at >= 0) {
        if (at > 0) this.log(line.slice(0, at));
        this.onResponse(line.slice(at + RESPONSE_MARKER.length));
      } else if (line) this.log(line);
    }
  }

  private protocolError(detail: string): void {
    this.failPending(
      new CalcServiceError("worker_crashed", "Calc worker broke the protocol", detail),
    );
    this.kill();
  }

  private onResponse(text: string): void {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (cause) {
      this.protocolError(
        `response is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return;
    }
    // Pick the branch by the raw object: the success branch of CalcResponse
    // would also accept an error object (its `result` is unknown).
    const isError = typeof json === "object" && json !== null && "error" in json;
    const [successBranch, errorBranch] = CalcResponse.options;
    const parsed = isError ? errorBranch.safeParse(json) : successBranch.safeParse(json);
    if (!parsed.success) {
      this.protocolError(`response does not match the contract: ${parsed.error.message}`);
      return;
    }
    const res = parsed.data;
    const p = this.pending;
    if (!p) {
      this.protocolError("response without a request");
      return;
    }
    // id null: the worker could not tie the error to a request (e.g. PoB failed to start).
    if (res.id !== null && res.id !== p.id) {
      this.protocolError(`response id ${String(res.id)} for request ${String(p.id)}`);
      return;
    }
    this.pending = null;
    clearTimeout(p.timer);
    if ("error" in res) {
      const { kind, detail } = res.error.data;
      p.reject(new CalcServiceError(kind, res.error.message, detail));
    } else {
      p.resolve(res.result);
    }
  }
}
