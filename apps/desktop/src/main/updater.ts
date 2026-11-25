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
  check(): Promise<void>;
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
  updater.autoInstallOnAppQuit = true;
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

  const check = async () => {
    if (downloaded) return;
    try {
      await updater.checkForUpdates();
    } catch (error) {
      setState({
        state: "failed",
        message: error instanceof Error ? error.message : "Update check failed",
      });
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
