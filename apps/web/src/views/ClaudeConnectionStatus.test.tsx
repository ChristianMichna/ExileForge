import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { EMPTY_RUN } from "../live/run-state";
import { ClaudeConnectionStatus, hintForFindings } from "./ClaudeConnectionStatus";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ClaudeConnectionStatus", () => {
  it("waits quietly at first, then explains what to check", () => {
    vi.useFakeTimers();
    render(<ClaudeConnectionStatus run={EMPTY_RUN} connection="live" patienceMs={1000} />);
    expect(screen.getByText("Waiting for Claude to connect")).toBeTruthy();
    expect(screen.queryByText("Claude has not connected yet")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("Claude has not connected yet")).toBeTruthy();
  });

  it("shows the connection once the run leaves created", () => {
    render(
      <ClaudeConnectionStatus
        run={{ ...EMPTY_RUN, phase: "planning" }}
        connection="live"
        patienceMs={1}
      />,
    );
    expect(screen.getByText("Claude is connected")).toBeTruthy();
    expect(screen.queryByText("Claude has not connected yet")).toBeNull();
  });

  it("does not blame Claude while the live stream is down", () => {
    vi.useFakeTimers();
    render(<ClaudeConnectionStatus run={EMPTY_RUN} connection="reconnecting" patienceMs={1000} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText("Claude has not connected yet")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Checking the run status…");
  });

  it("drops the warning when Claude connects late and stops the timer on unmount", () => {
    vi.useFakeTimers();
    const view = render(
      <ClaudeConnectionStatus run={EMPTY_RUN} connection="live" patienceMs={1000} />,
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("Claude has not connected yet")).toBeTruthy();
    view.rerender(
      <ClaudeConnectionStatus run={{ ...EMPTY_RUN, phase: "planning" }} connection="live" />,
    );
    expect(screen.queryByText("Claude has not connected yet")).toBeNull();
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
  });

  it("shows the wrong-shape hint and says when the run failed or is done", () => {
    const run = {
      ...EMPTY_RUN,
      phase: "failed" as const,
      lastFindings: ["expected object, received string"],
    };
    const view = render(<ClaudeConnectionStatus run={run} connection="live" />);
    expect(screen.getByText(/JSON object/)).toBeTruthy();
    expect(screen.getAllByRole("status").some((el) => el.textContent === "The run failed.")).toBe(
      true,
    );
    view.rerender(
      <ClaudeConnectionStatus run={{ ...EMPTY_RUN, phase: "done" }} connection="live" />,
    );
    expect(screen.getByRole("status").textContent).toBe("The run is done.");
  });

  it("explains the quoted-text mistake in plain words", () => {
    expect(hintForFindings(["expected object, received string"])).toContain("JSON object");
    expect(hintForFindings(["something else"])).toBeUndefined();
  });
});
