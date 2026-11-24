import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ItemView } from "./ItemTooltip";
import { ItemTooltip } from "./ItemTooltip";

afterEach(cleanup);

// Fantasy fixture for layout tests only; not game data.
const rare: ItemView = {
  id: "fixture/rare",
  rarity: "rare",
  name: "Test Name",
  baseType: "Test Base",
  itemClass: "Test Class",
  properties: [{ label: "Value A", value: "10", augmented: true }],
  requirements: [
    { label: "Level", value: "5", met: true },
    { label: "Strength", value: "99", met: false },
  ],
  implicits: [{ id: "i1", text: "Implicit line", kind: "implicit" }],
  explicits: [
    { id: "m1", text: "Prefix line", kind: "prefix", tier: 2, range: "(1–3)" },
    { id: "m2", text: "Suffix line", kind: "suffix", tier: 1 },
  ],
  acquisition: "Test source",
  provenance: { kind: "sample", fixture: "test" },
};

describe("ItemTooltip", () => {
  it("shows name and base type for rare items and names the rarity", () => {
    render(<ItemTooltip item={rare} />);
    expect(screen.getByRole("article", { name: "Rare: Test Name" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Test Name" })).toBeTruthy();
    expect(screen.getByText("Test Base")).toBeTruthy();
  });

  it("uses the base type as the only line for normal and magic items", () => {
    render(<ItemTooltip item={{ ...rare, rarity: "magic", name: "ignored" }} />);
    expect(screen.getByRole("heading", { name: "Test Base" })).toBeTruthy();
    expect(screen.queryByText("ignored")).toBeNull();
  });

  it("marks unmet requirements in text, not only in colour", () => {
    render(<ItemTooltip item={rare} />);
    expect(screen.getByText("(not met)", { exact: false })).toBeTruthy();
  });

  it("shows tiers and ranges only in the planner view", () => {
    const { rerender } = render(<ItemTooltip item={rare} />);
    expect(screen.queryByText("T2")).toBeNull();
    rerender(<ItemTooltip item={rare} showTiers />);
    expect(screen.getByText("T2")).toBeTruthy();
    expect(screen.getByText("(1–3)")).toBeTruthy();
    expect(screen.getByText("Prefix")).toBeTruthy();
  });

  it("shows where to get the item and where its numbers come from", () => {
    render(<ItemTooltip item={rare} />);
    expect(screen.getByText("Test source")).toBeTruthy();
    expect(screen.getByText("Sample value · test")).toBeTruthy();
  });
});
