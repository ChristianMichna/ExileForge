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
    render(<ClaudeConnectionStatus run={EMPTY_RUN} patienceMs={1000} />);
    expect(screen.getByText("Waiting for Claude to connect")).toBeTruthy();
    expect(screen.queryByText("Claude has not connected yet")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("Claude has not connected yet")).toBeTruthy();
  });

  it("shows the connection once the run leaves created", () => {
    render(<ClaudeConnectionStatus run={{ ...EMPTY_RUN, phase: "planning" }} patienceMs={1} />);
    expect(screen.getByText("Claude is connected")).toBeTruthy();
    expect(screen.queryByText("Claude has not connected yet")).toBeNull();
  });

  it("explains the quoted-text mistake in plain words", () => {
    expect(hintForFindings(["expected object, received string"])).toContain("JSON object");
    expect(hintForFindings(["something else"])).toBeUndefined();
  });
});
