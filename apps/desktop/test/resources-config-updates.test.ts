import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadDesktopConfig } from "../src/main/config.js";
import { findDataRelease, knownReleaseIds, resolveAppDirs } from "../src/main/resources.js";
import { StatusStore } from "../src/main/status.js";
import { startDataSync } from "../src/main/data-sync.js";
import { startUpdates, type UpdaterPort } from "../src/main/updater.js";

async function release(dir: string, id?: string) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "manifest.json"),
    JSON.stringify(id === undefined ? {} : { release: { id } }),
  );
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
    await release(d.bundledReleaseDir, "poe2-0.5.5.10+r12");
    expect(await findDataRelease(d)).toBe(d.bundledReleaseDir);
    await release(join(d.downloadedReleasesDir, "poe2-0.5.5.10+r2"), "poe2-0.5.5.10+r2");
    await release(join(d.downloadedReleasesDir, "poe2-0.5.10.1+r1"), "poe2-0.5.10.1+r1");
    expect(await findDataRelease(d)).toBe(join(d.downloadedReleasesDir, "poe2-0.5.10.1+r1"));
    expect(await knownReleaseIds(d)).toEqual([
      "poe2-0.5.5.10+r2",
      "poe2-0.5.10.1+r1",
      "poe2-0.5.5.10+r12",
    ]);
  });

  it("keeps the bundled release when it is newer than the downloads", async () => {
    const d = await dirs();
    await release(d.bundledReleaseDir, "poe2-1.0.0+r1");
    await release(join(d.downloadedReleasesDir, "poe2-0.5.5.10+r12"), "poe2-0.5.5.10+r12");
    expect(await findDataRelease(d)).toBe(d.bundledReleaseDir);
  });

  it("reports a bundled release whose manifest names no valid id", async () => {
    const d = await dirs();
    await release(d.bundledReleaseDir, "not-an-id");
    await expect(findDataRelease(d)).rejects.toThrow("no valid data release id");
    await expect(knownReleaseIds(d)).rejects.toThrow("no valid data release id");
  });

  it("skips download folders without a manifest or with foreign names", async () => {
    const d = await dirs();
    await mkdir(join(d.downloadedReleasesDir, "poe2-0.5.5.10+r3"), { recursive: true });
    await release(join(d.downloadedReleasesDir, "partial"), "x");
    await release(d.bundledReleaseDir, "poe2-0.5.5.10+r1");
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
    expect(d.pobHome).toBe(join("/repo", ".pob"));
    expect(d.calcWorkerLua).toBe(join("/repo", "apps", "calc", "lua", "worker.lua"));
  });

  it("finds PoB and the calc worker file in the resources when packaged", () => {
    const d = resolveAppDirs({
      packaged: true,
      resourcesPath: "/r",
      repoRoot: "/repo",
      userData: "/u",
    });
    expect(d.pobHome).toBe(join("/r", "pob"));
    expect(d.calcWorkerLua).toBe(join("/r", "calc-lua", "worker.lua"));
    expect(d.optimizerConfigPath).toBe(join("/r", "config", "optimizer", "tree.json"));
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
    const store = new StatusStore("1.0", { state: "idle" }, { state: "idle" });
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

describe("data sync", () => {
  const remote = (id: string) =>
    ({
      id,
      tag: `data-${id.replace("+", "-")}`,
      prerelease: true,
      publishedAt: "2026-01-01T00:00:00Z",
      catalogUrl: "https://github.com/o/r/releases/download/t/c.tar.gz",
      checksumUrl: "https://github.com/o/r/releases/download/t/c.tar.gz.sha256",
      catalogSize: 1,
    }) as const;
  function sync(over: Partial<Parameters<typeof startDataSync>[0]> = {}) {
    const states: string[] = [];
    const installs: string[] = [];
    const controller = startDataSync({
      list: async () => [remote("poe2-1.0.0+r1")],
      knownIds: async () => ["poe2-0.5.5.10+r12"],
      install: async (r) => {
        installs.push(r.id);
        return { id: r.id };
      },
      setState: (s) =>
        states.push(
          s.state === "ready" || s.state === "downloading" ? `${s.state}:${s.releaseId}` : s.state,
        ),
      includePrereleases: true,
      firstCheckDelayMs: 3_600_000,
      intervalMs: 3_600_000,
      ...over,
    });
    return { controller, states, installs };
  }

  it("installs a newer release once and then waits for the restart", async () => {
    const { controller, states, installs } = sync();
    expect((await controller.check()).result).toBe("installed");
    expect((await controller.check()).result).toBe("up-to-date");
    expect(installs).toEqual(["poe2-1.0.0+r1"]);
    expect(states).toEqual([
      "checking",
      "downloading:poe2-1.0.0+r1",
      "ready:poe2-1.0.0+r1",
      "ready:poe2-1.0.0+r1",
    ]);
    controller.stop();
  });

  it("reports up to date, ignores pre-releases when told to and refuses overlapping checks", async () => {
    const same = sync({ knownIds: async () => ["poe2-1.0.0+r1"] });
    expect((await same.controller.check()).result).toBe("up-to-date");
    const stable = sync({ includePrereleases: false });
    expect((await stable.controller.check()).result).toBe("up-to-date");
    expect(stable.installs).toEqual([]);
    let release: () => void = () => undefined;
    const slow = sync({
      list: () => new Promise((r) => (release = () => r([remote("poe2-1.0.0+r1")]))),
    });
    const first = slow.controller.check();
    expect((await slow.controller.check()).result).toBe("busy");
    release();
    expect((await first).result).toBe("installed");
    for (const s of [same, stable, slow]) s.controller.stop();
  });

  it("keeps a waiting release on show when a later check fails or hangs", async () => {
    let fail = false;
    const { controller, states } = sync({
      list: async () => {
        if (fail) throw new Error("offline");
        return [remote("poe2-1.0.0+r1")];
      },
    });
    await controller.check();
    fail = true;
    expect((await controller.check()).result).toBe("failed");
    expect(states.at(-1)).toBe("ready:poe2-1.0.0+r1");
    expect(states.slice(1)).not.toContain("checking");
    controller.stop();
  });

  it("ends a running request when stopped", async () => {
    let seen: AbortSignal | undefined;
    const { controller, states } = sync({
      list: (signal) =>
        new Promise((_resolve, reject) => {
          seen = signal;
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    const pending = controller.check();
    controller.stop();
    expect((await pending).result).toBe("failed");
    expect(seen?.aborted).toBe(true);
    expect(states.at(-1)).toBe("failed");
  });

  it("shows failures and keeps trying at the next interval", async () => {
    const errors: unknown[] = [];
    let fail = true;
    const { controller, states } = sync({
      list: async () => {
        if (fail) throw new Error("offline");
        return [remote("poe2-1.0.0+r1")];
      },
      onError: (e) => errors.push(e),
    });
    const outcome = await controller.check();
    expect(outcome).toEqual({ result: "failed", message: "offline" });
    expect(states.at(-1)).toBe("failed");
    expect(errors).toHaveLength(1);
    fail = false;
    expect((await controller.check()).result).toBe("installed");
    controller.stop();
  });
});
