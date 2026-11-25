import type { UpdateState } from "../shared/bridge.js";

/** The part of electron-updater's AppUpdater that the shell uses (also what tests fake). */
export interface UpdaterPort {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: "checking-for-update" | "update-not-available", cb: () => void): unknown;
  on(
    event: "update-available" | "update-downloaded",
    cb: (info: { version: string }) => void,
  ): unknown;
  on(event: "download-progress", cb: (progress: { percent: number }) => void): unknown;
  on(event: "error", cb: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdateController {
  /** "failed" carries the reason; errors also show in the status. */
  check(): Promise<{ result: "checked" | "already-downloaded" | "failed"; message?: string }>;
  installNow(): boolean;
  stop(): void;
}

export interface UpdateOptions {
  updater: UpdaterPort;
  setState: (state: UpdateState) => void;
  firstCheckDelayMs: number;
  intervalMs: number;
}

/**
 * Wires the updater events to the status and schedules checks. Errors become a
 * visible `failed` state; an installer is only started by `installNow` after
 * the download finished.
 */
export function startUpdates(opts: UpdateOptions): UpdateController {
  const { updater, setState } = opts;
  let downloaded = false;
  updater.autoDownload = true;
  // Without a code signature nothing is installed unasked: only the explicit restart button installs.
  updater.autoInstallOnAppQuit = false;
  updater.on("checking-for-update", () => setState({ state: "checking" }));
  updater.on("update-not-available", () => setState({ state: "idle" }));
  updater.on("update-available", () => setState({ state: "downloading", percent: 0 }));
  updater.on("download-progress", (p) =>
    setState({ state: "downloading", percent: Math.round(p.percent) }),
  );
  updater.on("update-downloaded", (info) => {
    downloaded = true;
    setState({ state: "ready", version: info.version });
  });
  updater.on("error", (error) => setState({ state: "failed", message: error.message }));

  const check: UpdateController["check"] = async () => {
    if (downloaded) return { result: "already-downloaded" };
    try {
      await updater.checkForUpdates();
      return { result: "checked" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Update check failed";
      console.error("update check failed", error);
      setState({ state: "failed", message });
      return { result: "failed", message };
    }
  };
  const first = setTimeout(() => void check(), opts.firstCheckDelayMs);
  const timer = setInterval(() => void check(), opts.intervalMs);
  first.unref();
  timer.unref();
  return {
    check,
    installNow() {
      if (!downloaded) return false;
      updater.quitAndInstall(false, true);
      return true;
    },
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
