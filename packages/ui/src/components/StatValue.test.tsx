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
        label="Treffer-DPS"
        state={{
          status: "ready",
          value: 12345,
          provenance: { kind: "pob", pobVersion: "0.0.0-test", calcProfile: "test-profile" },
        }}
      />,
    );
    expect(screen.getByText("12.345")).toBeTruthy();
    expect(screen.getByText("PoB 0.0.0-test · test-profile")).toBeTruthy();
  });

  it("never renders a number while PoB is still calculating", () => {
    const { container } = renderStat(<StatValue label="Leben" state={{ status: "loading" }} />);
    expect(screen.getByText("PoB rechnet …")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it("shows a failed calculation as an error, not as 0", () => {
    const { container } = renderStat(
      <StatValue label="Leben" state={{ status: "error", message: "Worker abgestürzt" }} />,
    );
    expect(screen.getByText("Rechnung fehlgeschlagen")).toBeTruthy();
    expect(screen.getByText("Worker abgestürzt")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\b0\b/);
  });

  it("labels missing data as uncalibrated", () => {
    renderStat(
      <StatValue
        label="Kosten"
        state={{ status: "uncalibrated", reason: "Kein Marktpreis für diese Liga" }}
      />,
    );
    expect(screen.getByText("unkalibriert")).toBeTruthy();
  });

  it("marks values from an older data release as stale", () => {
    renderStat(
      <StatValue
        label="Leben"
        state={{
          status: "ready",
          value: 10,
          stale: true,
          provenance: { kind: "sample", fixture: "calc-fake" },
        }}
      />,
    );
    expect(screen.getByText("veraltet nach Patch")).toBeTruthy();
  });
});

describe("formatNumber", () => {
  it("formats with German separators", () => {
    expect(formatNumber(1234567, "integer")).toBe("1.234.567");
    expect(formatNumber(1.5, "decimal1")).toBe("1,5");
    expect(formatNumber(75, "percent")).toBe("75 %");
    expect(formatNumber(1.5, "multiplier")).toBe("×1,50");
  });

  it("refuses non-finite values instead of showing a placeholder", () => {
    expect(() => formatNumber(Number.NaN, "integer")).toThrow(/non-finite/);
  });
});

describe("provenanceLabel", () => {
  it("names every kind", () => {
    expect(provenanceLabel({ kind: "market", provider: "Test", fetchedAt: "heute" })).toBe(
      "Markt · Test · heute",
    );
    expect(provenanceLabel({ kind: "derived", formula: "a × b" })).toBe("berechnet · a × b");
    expect(provenanceLabel({ kind: "gamedata", dataRelease: "r1" })).toBe("Spieldaten · r1");
    expect(provenanceLabel({ kind: "sample", fixture: "calc-fake" })).toBe(
      "Beispielwert · calc-fake",
    );
  });
});
