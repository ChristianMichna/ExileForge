import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Button } from "./Button";
import { Callout } from "./Callout";
import { Panel } from "./Panel";

afterEach(cleanup);

describe("Button", () => {
  it("is disabled and marked busy while working", () => {
    render(<Button busy>Recalculate</Button>);
    const button = screen.getByRole("button", { name: "Recalculate" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>OK</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });
});

describe("Callout", () => {
  it("announces live errors as alerts and names the tone in text", () => {
    render(<Callout tone="danger" title="PoB unreachable" live />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Error: PoB unreachable");
  });

  it("is not a live region unless asked", () => {
    render(<Callout tone="danger" title="Static" />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("Panel", () => {
  it("is a region labelled by its title", () => {
    render(
      <Panel title="Equipment">
        <p>Content</p>
      </Panel>,
    );
    expect(screen.getByRole("region", { name: "Equipment" })).toBeTruthy();
  });
});
