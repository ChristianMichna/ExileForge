import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App";
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
    expect(parseRoute("#/unknown")).toBe("overview");
    expect(parseRoute("")).toBe("overview");
  });
});
