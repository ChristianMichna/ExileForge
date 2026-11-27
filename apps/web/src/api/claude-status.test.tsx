import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { MCP_CHECK_TIMEOUT_MS, loadClaudeStatus, useMcpReach } from "./claude-status";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const answer = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("loadClaudeStatus", () => {
  it("returns the time or null and rejects an unknown shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(await answer(200, { mcpLastCallAt: null })),
    );
    expect(await loadClaudeStatus()).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(await answer(200, { nope: 1 })));
    await expect(loadClaudeStatus()).rejects.toThrow(/does not understand/);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(await answer(401, { error: { message: "Missing token" } })),
    );
    await expect(loadClaudeStatus()).rejects.toThrow("Missing token");
  });
});

describe("useMcpReach", () => {
  it("keeps asking until Claude has reached the server, then stops", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => answer(200, { mcpLastCallAt: null }))
      .mockImplementation(() => answer(200, { mcpLastCallAt: "2026-11-27T00:00:00Z" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useMcpReach(true, 1000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.kind).toBe("not_yet");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.kind).toBe("reached");
    const calls = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("reports a failed check and does not ask while switched off", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => answer(500, { error: { message: "boom" } }));
    vi.stubGlobal("fetch", fetchMock);
    const off = renderHook(() => useMcpReach(false, 1000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(off.result.current.kind).toBe("checking");
    const on = renderHook(() => useMcpReach(true, 1000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(on.result.current).toEqual({ kind: "error", message: "boom" });
  });

  it("turns a hanging check into an error, keeps asking and recovers", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("x", "AbortError")),
            );
          }),
      )
      .mockImplementation(() => answer(200, { mcpLastCallAt: "2026-11-27T00:00:00Z" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useMcpReach(true, 1000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MCP_CHECK_TIMEOUT_MS);
    });
    expect(result.current).toEqual({ kind: "error", message: "The check timed out." });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.kind).toBe("reached");
  });

  it("says plainly when the local server cannot be reached", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { result } = renderHook(() => useMcpReach(true, 1000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toEqual({
      kind: "error",
      message: "Could not reach the local Astrolabe server.",
    });
  });

  it("stops asking and drops the running check when the page goes away", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("x", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const view = renderHook(() => useMcpReach(true, 1000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    view.unmount();
    expect(aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
