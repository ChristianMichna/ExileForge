import { pickNewRelease, type RemoteRelease } from "@astrolabe/release-sync";
import type { DataState } from "../shared/bridge.js";

export interface DataSyncOptions {
  /** Lists the data releases GitHub offers (throws when it cannot). */
  list: (signal: AbortSignal) => Promise<RemoteRelease[]>;
  /** Ids of everything already usable: downloaded releases, the bundled one and the one running. */
  knownIds: () => Promise<string[]>;
  /** Downloads, verifies and installs; throws on any problem. */
  install: (release: RemoteRelease, signal: AbortSignal) => Promise<{ id: string }>;
  setState: (state: DataState) => void;
  includePrereleases: boolean;
  firstCheckDelayMs: number;
  intervalMs: number;
  /** Called with a plain explanation whenever a check or install fails. */
  onError?: (error: unknown) => void;
}

export interface DataSyncController {
  check(): Promise<{ result: "installed" | "up-to-date" | "busy" | "failed"; message?: string }>;
  stop(): void;
}

/**
 * Looks for a new data release now and then and installs it. The running server keeps its
 * catalog; the new release is used after a restart (state `ready`). Problems become a visible
 * `failed` state and are tried again at the next interval; nothing is silently skipped.
 */
export function startDataSync(options: DataSyncOptions): DataSyncController {
  const { setState } = options;
  let running = false;
  let installedId: string | undefined;
  // stop() ends a request that is still running
  const abort = new AbortController();

  const check: DataSyncController["check"] = async () => {
    if (running) return { result: "busy" };
    running = true;
    try {
      // a release that already waits for the restart stays on show while we look again
      if (installedId === undefined) setState({ state: "checking" });
      const remote = await options.list(abort.signal);
      const known = await options.knownIds();
      if (installedId !== undefined) known.push(installedId);
      const next = pickNewRelease(remote, known, {
        includePrereleases: options.includePrereleases,
      });
      if (next === undefined) {
        setState(
          installedId === undefined
            ? { state: "idle" }
            : { state: "ready", releaseId: installedId },
        );
        return { result: "up-to-date" };
      }
      setState({ state: "downloading", releaseId: next.id });
      const done = await options.install(next, abort.signal);
      installedId = done.id;
      setState({ state: "ready", releaseId: done.id });
      return { result: "installed" };
    } catch (error) {
      options.onError?.(error);
      const message = error instanceof Error ? error.message : "Looking for new game data failed";
      // never hide a release that is installed and waiting for the restart behind a failed check
      setState(
        installedId === undefined
          ? { state: "failed", message }
          : { state: "ready", releaseId: installedId },
      );
      return { result: "failed", message };
    } finally {
      running = false;
    }
  };

  const first = setTimeout(() => void check(), options.firstCheckDelayMs);
  const timer = setInterval(() => void check(), options.intervalMs);
  first.unref();
  timer.unref();
  return {
    check,
    stop() {
      abort.abort();
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
