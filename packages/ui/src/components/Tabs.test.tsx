import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Tabs } from "./Tabs";

afterEach(cleanup);

function Harness() {
  const [value, setValue] = useState("a");
  return (
    <Tabs
      label="Stufen"
      value={value}
      onChange={setValue}
      items={[
        { id: "a", label: "Eins", content: <p>Inhalt A</p> },
        { id: "b", label: "Zwei", disabled: true, content: <p>Inhalt B</p> },
        { id: "c", label: "Drei", content: <p>Inhalt C</p> },
      ]}
    />
  );
}

describe("Tabs", () => {
  it("renders the selected panel linked to its tab", () => {
    render(<Harness />);
    const tab = screen.getByRole("tab", { name: "Eins" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    expect(panel.textContent).toBe("Inhalt A");
  });

  it("switches on click", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("tab", { name: "Drei" }));
    expect(screen.getByRole("tabpanel").textContent).toBe("Inhalt C");
  });

  it("moves with arrow keys and skips disabled tabs", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Drei" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Drei" }));
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Eins" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(list, { key: "End" });
    expect(screen.getByRole("tabpanel").textContent).toBe("Inhalt C");
  });

  it("keeps only the selected tab in the tab order", () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "Eins" }).tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: "Drei" }).tabIndex).toBe(-1);
  });
});
