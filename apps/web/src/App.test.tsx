import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
