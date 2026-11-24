import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Tabs } from "./Tabs";

afterEach(cleanup);

function Harness() {
  const [value, setValue] = useState("a");
  return (
    <Tabs
      label="Stages"
      value={value}
      onChange={setValue}
      items={[
        { id: "a", label: "One", content: <p>Content A</p> },
        { id: "b", label: "Two", disabled: true, content: <p>Content B</p> },
        { id: "c", label: "Three", content: <p>Content C</p> },
      ]}
    />
  );
}

describe("Tabs", () => {
  it("renders the selected panel linked to its tab", () => {
    render(<Harness />);
    const tab = screen.getByRole("tab", { name: "One" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    expect(panel.textContent).toBe("Content A");
  });

  it("switches on click", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("tab", { name: "Three" }));
    expect(screen.getByRole("tabpanel").textContent).toBe("Content C");
  });

  it("moves with arrow keys and skips disabled tabs", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Three" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Three" }));
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "One" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(list, { key: "End" });
    expect(screen.getByRole("tabpanel").textContent).toBe("Content C");
  });

  it("falls back to the first enabled tab for keyboard focus", () => {
    render(
      <Tabs
        label="Stages"
        value="unknown"
        onChange={() => undefined}
        items={[{ id: "a", label: "One", content: null }]}
      />,
    );
    expect(screen.getByRole("tab", { name: "One" }).tabIndex).toBe(0);
  });

  it("keeps only the selected tab in the tab order", () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "One" }).tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: "Three" }).tabIndex).toBe(-1);
  });
});
