import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatGrid, StatValue } from "./StatValue";
import { formatNumber, provenanceLabel } from "./provenance";

afterEach(cleanup);

function renderStat(node: ReactElement) {
  return render(<StatGrid>{node}</StatGrid>);
}

describe("StatValue", () => {
  it("shows the number together with its PoB provenance", () => {
    renderStat(
      <StatValue
        label="Hit DPS"
        state={{
          status: "ready",
          value: 12345,
          provenance: { kind: "pob", pobVersion: "0.0.0-test", calcProfile: "test-profile" },
        }}
      />,
    );
    expect(screen.getByText("12,345")).toBeTruthy();
    expect(screen.getByText("PoB 0.0.0-test · test-profile")).toBeTruthy();
  });

  it("never renders a number while PoB is still calculating", () => {
    const { container } = renderStat(<StatValue label="Life" state={{ status: "loading" }} />);
    expect(screen.getByText("Calculating …")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it("shows a failed calculation as an error, not as 0", () => {
    const { container } = renderStat(
      <StatValue label="Life" state={{ status: "error", message: "Worker crashed" }} />,
    );
    expect(screen.getByText("Value unavailable")).toBeTruthy();
    expect(screen.getByText("Worker crashed")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\b0\b/);
  });

  it("shows a non-finite engine value as invalid instead of crashing", () => {
    renderStat(
      <StatValue
        label="Life"
        state={{
          status: "ready",
          value: Number.NaN,
          provenance: { kind: "sample", fixture: "calc-fake" },
        }}
      />,
    );
    expect(screen.getByText("Invalid value")).toBeTruthy();
  });

  it("labels missing data as uncalibrated", () => {
    renderStat(
      <StatValue
        label="Cost"
        state={{ status: "uncalibrated", reason: "No market price for this league" }}
      />,
    );
    expect(screen.getByText("Uncalibrated")).toBeTruthy();
  });

  it("marks values from an older data release as stale", () => {
    renderStat(
      <StatValue
        label="Life"
        state={{
          status: "ready",
          value: 10,
          stale: true,
          provenance: { kind: "sample", fixture: "calc-fake" },
        }}
      />,
    );
    expect(screen.getByText("Outdated after patch")).toBeTruthy();
  });
});

describe("formatNumber", () => {
  it("formats with English separators", () => {
    expect(formatNumber(1234567, "integer")).toBe("1,234,567");
    expect(formatNumber(1.5, "decimal1")).toBe("1.5");
    expect(formatNumber(75, "percent")).toBe("75%");
    expect(formatNumber(1.5, "multiplier")).toBe("×1.50");
  });

  it("refuses non-finite values instead of showing a placeholder", () => {
    expect(() => formatNumber(Number.NaN, "integer")).toThrow(/non-finite/);
  });
});

describe("provenanceLabel", () => {
  it("names every kind", () => {
    expect(provenanceLabel({ kind: "market", provider: "Test", fetchedAt: "today" })).toBe(
      "Market · Test · today",
    );
    expect(provenanceLabel({ kind: "derived", formula: "a × b" })).toBe("Derived · a × b");
    expect(provenanceLabel({ kind: "gamedata", dataRelease: "r1" })).toBe("Game data · r1");
    expect(provenanceLabel({ kind: "sample", fixture: "calc-fake" })).toBe(
      "Sample value · calc-fake",
    );
  });
});
