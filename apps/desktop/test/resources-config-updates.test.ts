import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadDesktopConfig } from "../src/main/config.js";
import { findDataRelease, resolveAppDirs } from "../src/main/resources.js";
import { StatusStore } from "../src/main/status.js";
import { startUpdates, type UpdaterPort } from "../src/main/updater.js";

async function release(dir: string, mtime?: number) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "manifest.json"), "{}");
  if (mtime !== undefined) await utimes(dir, mtime, mtime);
}

describe("data release lookup", () => {
  async function dirs() {
    const base = await mkdtemp(join(tmpdir(), "ef-res-"));
    return resolveAppDirs({
      packaged: true,
      resourcesPath: join(base, "res"),
      repoRoot: base,
      userData: join(base, "user"),
    });
  }

  it("throws a plain message when there is no release", async () => {
    await expect(findDataRelease(await dirs())).rejects.toThrow("No game data found");
  });

  it("uses the bundled release, and a newer download over it", async () => {
    const d = await dirs();
    await release(d.bundledReleaseDir);
    expect(await findDataRelease(d)).toBe(d.bundledReleaseDir);
    await release(join(d.downloadedReleasesDir, "old"), 1_000);
    await release(join(d.downloadedReleasesDir, "new"), 2_000);
    expect(await findDataRelease(d)).toBe(join(d.downloadedReleasesDir, "new"));
  });

  it("skips download folders without a manifest", async () => {
    const d = await dirs();
    await mkdir(join(d.downloadedReleasesDir, "partial"), { recursive: true });
    await release(d.bundledReleaseDir);
    expect(await findDataRelease(d)).toBe(d.bundledReleaseDir);
  });

  it("refuses an override without manifest", async () => {
    await expect(findDataRelease(await dirs(), "/nonexistent")).rejects.toThrow("manifest.json");
  });

  it("uses the repository layout when not packaged", () => {
    const d = resolveAppDirs({
      packaged: false,
      resourcesPath: "/r",
      repoRoot: "/repo",
      userData: "/u",
    });
    expect(d.webRoot).toBe(join("/repo", "apps", "web", "dist"));
    expect(d.databasePath).toBe(join("/u", "astrolabe.sqlite"));
  });
});

describe("desktop config", () => {
  it("accepts the committed config", async () => {
    const config = await loadDesktopConfig(join(__dirname, "../../../config/desktop/desktop.json"));
    expect(config.port).toBe(47615);
    expect(config.claude.startSentence).toContain("{code}");
  });

  it("rejects a desktop URL whose scheme is not allowed", async () => {
    const base = await mkdtemp(join(tmpdir(), "ef-cfg-"));
    const path = join(base, "desktop.json");
    const good = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(join(__dirname, "../../../config/desktop/desktop.json"), "utf8"),
    ) as { claude: { desktopUrl: string } };
    good.claude.desktopUrl = "https://example.com";
    await writeFile(path, JSON.stringify(good));
    await expect(loadDesktopConfig(path)).rejects.toThrow("not in allowedSchemes");
  });

  it("reports a missing file with its cause", async () => {
    await expect(loadDesktopConfig("/nope.json")).rejects.toThrow("Cannot read desktop config");
  });
});

describe("status store", () => {
  it("notifies listeners about each change", () => {
    const store = new StatusStore("1.0", { state: "idle" });
    const seen: string[] = [];
    const off = store.subscribe((s) => seen.push(s.server.state));
    store.setServer({ state: "failed", message: "x" });
    off();
    store.setServer({ state: "starting" });
    expect(seen).toEqual(["failed"]);
    expect(store.get().server.state).toBe("starting");
  });
});

describe("updates", () => {
  function fakeUpdater() {
    const handlers = new Map<string, (arg?: never) => void>();
    const updater = {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      on: (event: string, cb: (arg?: never) => void) => void handlers.set(event, cb),
      checkForUpdates: vi.fn(async () => undefined),
      quitAndInstall: vi.fn(),
    };
    return {
      updater: updater as unknown as UpdaterPort & typeof updater,
      emit: (e: string, a?: unknown) => handlers.get(e)?.(a as never),
    };
  }

  it("turns updater events into states and installs only after the download", async () => {
    const { updater, emit } = fakeUpdater();
    const states: string[] = [];
    const controller = startUpdates({
      updater,
      setState: (s) =>
        states.push(s.state === "downloading" ? `downloading ${s.percent}` : s.state),
      firstCheckDelayMs: 1e9,
      intervalMs: 1e9,
    });
    expect(updater.autoDownload).toBe(true);
    expect(controller.installNow()).toBe(false);
    emit("checking-for-update");
    emit("update-available", { version: "2" });
    emit("download-progress", { percent: 41.6 });
    emit("update-downloaded", { version: "2" });
    expect(states).toEqual(["checking", "downloading 0", "downloading 42", "ready"]);
    expect(controller.installNow()).toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalled();
    controller.stop();
  });

  it("shows a failed check instead of hiding it", async () => {
    const { updater } = fakeUpdater();
    updater.checkForUpdates.mockRejectedValueOnce(new Error("offline"));
    const states: { state: string; message?: string }[] = [];
    const controller = startUpdates({
      updater,
      setState: (s) => states.push(s),
      firstCheckDelayMs: 1e9,
      intervalMs: 1e9,
    });
    await controller.check();
    expect(states.at(-1)).toMatchObject({ state: "failed", message: "offline" });
    controller.stop();
  });
});
