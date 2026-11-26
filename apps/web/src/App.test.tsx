import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App";
import type { AppStatus } from "./desktop/bridge";
import { parseRoute } from "./shell/route";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("App", () => {
  it("shows the build overview by default", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Emberweaver");
    expect(screen.getByRole("link", { name: "Build" }).getAttribute("aria-current")).toBe("page");
  });

  it("opens the design-system gallery via hash route", () => {
    window.location.hash = "#/design";
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Design System");
  });

  it("opens the passive tree page via hash route", () => {
    window.location.hash = "#/tree";
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Passive Tree");
    expect(screen.getByRole("link", { name: "Passive Tree" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("shows the third-party notice required by GGG's guidelines", () => {
    render(<App />);
    expect(screen.getByText(/Not affiliated with or endorsed by Grinding Gear Games/)).toBeTruthy();
  });

  it("labels all sample numbers as sample values", () => {
    render(<App />);
    expect(screen.getAllByText(/Sample value · calc-fake/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^PoB \d/)).toBeNull();
  });
});

describe("parseRoute", () => {
  it("falls back to the overview for unknown hashes", () => {
    expect(parseRoute("#/design")).toBe("design");
    expect(parseRoute("#/tree")).toBe("tree");
    expect(parseRoute("#/unknown")).toBe("overview");
    expect(parseRoute("")).toBe("overview");
  });
});

describe("planning view", () => {
  it("is hidden from the navigation in a normal browser and explains itself", () => {
    window.location.hash = "#/plan";
    render(<App />);
    expect(screen.queryByRole("link", { name: "Plan" })).toBeNull();
    expect(screen.getByText("Planning needs the desktop app")).toBeTruthy();
  });

  it("parses the plan route", () => {
    expect(parseRoute("#/plan")).toBe("plan");
  });
});

describe("catalog-only mode", () => {
  function installBridge(reason: string | undefined) {
    const status: AppStatus = {
      appVersion: "0.0.0",
      server: {
        state: "ready",
        port: 1,
        calcEngine: "none",
        dataReleaseId: "poe2-1.0.0+r1",
        ...(reason === undefined ? {} : { catalogOnlyReason: reason }),
      },
      update: { state: "idle" },
      data: { state: "idle" },
    };
    window.astrolabe = {
      getStatus: () => Promise.resolve(status),
      onStatus: () => () => undefined,
    } as never;
  }
  afterEach(() => {
    delete window.astrolabe;
  });

  it("shows the badge and replaces the planning form with the reason", async () => {
    installBridge("Catalog only: needs Path of Building v1.0.0");
    window.location.hash = "#/plan";
    render(<App />);
    expect(await screen.findByText("Catalog only")).toBeTruthy();
    expect(screen.getByText(/needs Path of Building v1\.0\.0/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /plan/i })).toBeNull();
  });

  it("falls back to a fixed text without a reason", async () => {
    installBridge(undefined);
    window.location.hash = "#/plan";
    render(<App />);
    expect(await screen.findByText(/no matching Path of Building/)).toBeTruthy();
  });
});

describe("saved guide check", () => {
  const G1 = "11111111-1111-4111-8111-111111111111";
  const G2 = "22222222-2222-4222-8222-222222222222";
  const G3 = "33333333-3333-4333-8333-333333333333";
  const base = {
    enabled: true,
    releaseId: "poe2-1.0.0+r1",
    running: false,
    guides: [] as unknown[],
  };
  const status = (guideId: string, verdict: string, over: object = {}) => ({
    guideId,
    checkedAt: "2026-11-26T09:00:00.000Z",
    outcome: {
      kind: "status",
      status: {
        schemaVersion: 1,
        guideId,
        guideRevision: 0,
        fromReleaseId: "poe2-0.9.0+r1",
        toReleaseId: "poe2-1.0.0+r1",
        chain: ["poe2-0.9.0+r1", "poe2-1.0.0+r1"],
        factChanges: [],
        checkedAt: "2026-11-26T09:00:00.000Z",
        checkedReferences: 12,
        verdict,
        findings: [],
        ...over,
      },
    },
  });
  const json = (body: unknown, init: ResponseInit = { status: 200 }) =>
    Promise.resolve(new Response(JSON.stringify(body), init));

  function openPlanPage(fetchMock: ReturnType<typeof vi.fn>) {
    const appStatus: AppStatus = {
      appVersion: "0.0.0",
      server: { state: "ready", port: 1, calcEngine: "pob", dataReleaseId: "poe2-1.0.0+r1" },
      update: { state: "idle" },
      data: { state: "idle" },
    };
    window.astrolabe = {
      getStatus: () => Promise.resolve(appStatus),
      onStatus: () => () => undefined,
    } as never;
    vi.stubGlobal("fetch", fetchMock);
    window.location.hash = "#/plan";
    render(<App />);
  }

  afterEach(() => {
    delete window.astrolabe;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("lists a guide that could not be checked with its code", async () => {
    openPlanPage(
      vi.fn(() =>
        json({
          ...base,
          guides: [
            {
              guideId: G1,
              checkedAt: "2026-11-26T09:00:00.000Z",
              outcome: { kind: "error", code: "diff_missing", message: "The chain is incomplete." },
            },
          ],
        }),
      ),
    );
    expect(await screen.findByText("Could not be checked")).toBeTruthy();
    expect(screen.getByText(/diff_missing/)).toBeTruthy();
  });

  it("shows each verdict and says why a guide needs recalculation when only release facts changed", async () => {
    openPlanPage(
      vi.fn(() =>
        json({
          ...base,
          guides: [
            status(G1, "unaffected"),
            status(G2, "needs-recalc", { factChanges: ["pobVersion"] }),
            status(G3, "broken", {
              findings: [
                { ref: { kind: "gem", id: "g" }, impact: "removed", locations: ["/summary"] },
              ],
            }),
          ],
        }),
      ),
    );
    expect(await screen.findByText("Unaffected by the patch")).toBeTruthy();
    expect(screen.getByText("Needs recalculation")).toBeTruthy();
    expect(screen.getByText(/Path of Building version/)).toBeTruthy();
    expect(screen.getByText("Broken: uses removed content")).toBeTruthy();
    expect(screen.getByText(/1 removed, 0 changed of 12 entities/)).toBeTruthy();
  });

  it("says when the check is switched off instead of showing an empty list", async () => {
    openPlanPage(vi.fn(() => json({ ...base, enabled: false })));
    expect(await screen.findByText("Saved guides are not checked")).toBeTruthy();
  });

  it("shows the server's reason when loading fails, and can try again", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        json({ error: { code: "internal", message: "Disk is full." } }, { status: 500 }),
      )
      .mockImplementation(() => json(base));
    openPlanPage(fetchMock);
    expect(await screen.findByText("Disk is full.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/No saved guide needs a check/)).toBeTruthy();
  });

  it("does not show an answer that does not match the contract as if it were data", async () => {
    openPlanPage(vi.fn(() => json({ nonsense: true })));
    expect(await screen.findByText(/does not understand/)).toBeTruthy();
  });

  it("keeps the last list when a later update fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        json({ ...base, running: true, guides: [status(G1, "unaffected")] }),
      )
      .mockImplementation(() =>
        json({ error: { message: "Server restarting." } }, { status: 503 }),
      );
    openPlanPage(fetchMock);
    expect(await screen.findByText("Unaffected by the patch")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(3100);
    expect(await screen.findByText(/Server restarting\./)).toBeTruthy();
    expect(screen.getByText("Unaffected by the patch")).toBeTruthy();
  });

  it("polls while the server checks, stops when it is done, and refreshes with a POST", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => json({ ...base, running: true }))
      .mockImplementation(() => json(base));
    openPlanPage(fetchMock);
    expect(await screen.findByText(/Checking…/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3100);
    expect(await screen.findByText(/No saved guide needs a check/)).toBeTruthy();
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock.mock.calls.length).toBe(calls);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    const last = fetchMock.mock.calls.at(-1) as [string, { method: string }];
    expect(last[0]).toBe("/api/guides/patch-status/refresh");
    expect(last[1].method).toBe("POST");
  });
});
