import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Button } from "./Button";
import { Callout } from "./Callout";
import { Panel } from "./Panel";

afterEach(cleanup);

describe("Button", () => {
  it("is disabled and marked busy while working", () => {
    render(<Button busy>Neu berechnen</Button>);
    const button = screen.getByRole("button", { name: "Neu berechnen" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>OK</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });
});

describe("Callout", () => {
  it("announces errors as alerts and names the tone in text", () => {
    render(<Callout tone="danger" title="PoB nicht erreichbar" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Fehler: PoB nicht erreichbar");
  });
});

describe("Panel", () => {
  it("is a region labelled by its title", () => {
    render(
      <Panel title="Ausrüstung">
        <p>Inhalt</p>
      </Panel>,
    );
    expect(screen.getByRole("region", { name: "Ausrüstung" })).toBeTruthy();
  });
});
