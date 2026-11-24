import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ItemView } from "./ItemTooltip";
import { ItemTooltip } from "./ItemTooltip";

afterEach(cleanup);

// Fantasy fixture for layout tests only; not game data.
const rare: ItemView = {
  id: "fixture/rare",
  rarity: "rare",
  name: "Testname",
  baseType: "Testbasis",
  itemClass: "Testklasse",
  properties: [{ label: "Wert A", value: "10", augmented: true }],
  requirements: [
    { label: "Stufe", value: "5", met: true },
    { label: "Stärke", value: "99", met: false },
  ],
  implicits: [{ id: "i1", text: "Implizite Zeile", kind: "implicit" }],
  explicits: [
    { id: "m1", text: "Präfix-Zeile", kind: "prefix", tier: 2, range: "(1–3)" },
    { id: "m2", text: "Suffix-Zeile", kind: "suffix", tier: 1 },
  ],
  acquisition: "Testquelle",
};

describe("ItemTooltip", () => {
  it("shows name and base type for rare items and names the rarity", () => {
    render(<ItemTooltip item={rare} />);
    expect(screen.getByRole("article", { name: "Selten: Testname" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Testname" })).toBeTruthy();
    expect(screen.getByText("Testbasis")).toBeTruthy();
  });

  it("uses the base type as the only line for normal and magic items", () => {
    render(<ItemTooltip item={{ ...rare, rarity: "magic", name: "ignoriert" }} />);
    expect(screen.getByRole("heading", { name: "Testbasis" })).toBeTruthy();
    expect(screen.queryByText("ignoriert")).toBeNull();
  });

  it("marks unmet requirements in text, not only in colour", () => {
    render(<ItemTooltip item={rare} />);
    expect(screen.getByText("(nicht erfüllt)", { exact: false })).toBeTruthy();
  });

  it("shows tiers and ranges only in the planner view", () => {
    const { rerender } = render(<ItemTooltip item={rare} />);
    expect(screen.queryByText("T2")).toBeNull();
    rerender(<ItemTooltip item={rare} showTiers />);
    expect(screen.getByText("T2")).toBeTruthy();
    expect(screen.getByText("(1–3)")).toBeTruthy();
    expect(screen.getByText("Präfix")).toBeTruthy();
  });

  it("shows where to get the item", () => {
    render(<ItemTooltip item={rare} />);
    expect(screen.getByText("Testquelle")).toBeTruthy();
  });
});
