import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App";

afterEach(cleanup);

describe("App placeholder", () => {
  it("renders the product name", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("ExileForge");
  });

  it("shows the third-party notice required by GGG's guidelines", () => {
    render(<App />);
    expect(screen.getByText(/Nicht mit Grinding Gear Games verbunden/)).toBeTruthy();
  });
});
