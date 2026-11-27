import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { EMPTY_RUN } from "../live/run-state";
import type { McpReach } from "../api/claude-status";
import { ClaudeConnectionStatus, hintForFindings } from "./ClaudeConnectionStatus";

const NOT_YET: McpReach = { kind: "not_yet" };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ClaudeConnectionStatus", () => {
  it("waits quietly at first, then explains what to check", () => {
    vi.useFakeTimers();
    render(
      <ClaudeConnectionStatus run={EMPTY_RUN} connection="live" mcp={NOT_YET} patienceMs={1000} />,
    );
    expect(screen.getByText("Waiting for the Claude extension")).toBeTruthy();
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
        mcp={NOT_YET}
        patienceMs={1}
      />,
    );
    expect(screen.getByText("Claude is connected")).toBeTruthy();
    expect(screen.queryByText("Claude has not connected yet")).toBeNull();
  });

  it("does not blame Claude while the live stream is down", () => {
    vi.useFakeTimers();
    render(
      <ClaudeConnectionStatus
        run={EMPTY_RUN}
        connection="reconnecting"
        mcp={NOT_YET}
        patienceMs={1000}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText("Claude has not connected yet")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Checking the run status…");
  });

  it("drops the warning when Claude connects late and stops the timer on unmount", () => {
    vi.useFakeTimers();
    const view = render(
      <ClaudeConnectionStatus run={EMPTY_RUN} connection="live" mcp={NOT_YET} patienceMs={1000} />,
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("Claude has not connected yet")).toBeTruthy();
    view.rerender(
      <ClaudeConnectionStatus
        run={{ ...EMPTY_RUN, phase: "planning" }}
        connection="live"
        mcp={NOT_YET}
      />,
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
    const view = render(<ClaudeConnectionStatus run={run} connection="live" mcp={NOT_YET} />);
    expect(screen.getByText(/JSON object/)).toBeTruthy();
    expect(screen.getAllByRole("status").some((el) => el.textContent === "The run failed.")).toBe(
      true,
    );
    view.rerender(
      <ClaudeConnectionStatus
        run={{ ...EMPTY_RUN, phase: "done" }}
        connection="live"
        mcp={NOT_YET}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("The run is done.");
  });

  it("tells when Claude reached the server but has not picked up the run", () => {
    render(
      <ClaudeConnectionStatus
        run={EMPTY_RUN}
        connection="live"
        mcp={{ kind: "reached", at: "2026-11-27T00:00:00Z" }}
      />,
    );
    expect(screen.getByText("Claude has reached Astrolabe")).toBeTruthy();
    expect(screen.getByText("Waiting for Claude to pick up the run")).toBeTruthy();
  });

  it("shows a failed check instead of guessing", () => {
    render(
      <ClaudeConnectionStatus
        run={EMPTY_RUN}
        connection="live"
        mcp={{ kind: "error", message: "The server answered HTTP 500." }}
      />,
    );
    expect(screen.getByText("The server answered HTTP 500.")).toBeTruthy();
    expect(screen.getByText("Waiting for the Claude extension")).toBeTruthy();
  });

  it("explains the quoted-text mistake in plain words", () => {
    expect(hintForFindings(["expected object, received string"])).toContain("JSON object");
    expect(hintForFindings(["something else"])).toBeUndefined();
  });
});
