import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GROUPS, ids, sampleTree } from "./fixtures.test-util";
import { PassiveTree } from "./PassiveTree";
import { buildTreeView } from "./tree-model";
import { buildTimeline } from "./tree-timeline";

// WebGL is not available in jsdom: the renderer is replaced by a recorder.
const calls = vi.hoisted(() => ({
  highlights: [] as unknown[],
  fits: [] as unknown[],
  focus: [] as unknown[],
  pans: [] as unknown[],
  fail: false,
  onError: undefined as ((e: Error) => void) | undefined,
}));
vi.mock("./renderer", () => ({
  TreeRenderer: {
    create: (_host: unknown, opts: { onError?: (e: Error) => void }) => {
      if (calls.fail)
        return Promise.reject(
          new Error("Tree renderer could not start", { cause: new Error("WebGL unavailable") }),
        );
      calls.onError = opts.onError;
      return Promise.resolve({
        setHighlight: (h: unknown) => calls.highlights.push(h),
        setFocus: (id: unknown) => calls.focus.push(id),
        fit: (...args: unknown[]) => calls.fits.push(args),
        zoomBy: () => undefined,
        panBy: (...args: unknown[]) => calls.pans.push(args),
        project: () => ({ x: 10, y: 20 }),
        destroy: () => undefined,
      });
    },
  },
}));

const view = buildTreeView(sampleTree(), GROUPS, { include: (n) => !n.ascendancyId });
const timeline = buildTimeline([
  {
    key: "s1",
    label: "First Steps",
    levelRange: [1, 10],
    allocationOrder: ids(["a", "b"]),
    respecs: ids([]),
  },
  {
    key: "s2",
    label: "Second Wind",
    levelRange: [11, 20],
    allocationOrder: ids(["n", "k"]),
    respecs: ids(["b"]),
  },
]);

async function renderTree(initialStage = 1) {
  render(
    <PassiveTree
      view={view}
      timeline={timeline}
      initialStage={initialStage}
      provenance={{ kind: "gamedata", dataRelease: "fake+r1" }}
      allocationSource="Allocation: test fixture"
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  calls.highlights = [];
  calls.fits = [];
  calls.focus = [];
  calls.pans = [];
  calls.fail = false;
  vi.useRealTimers();
});

describe("PassiveTree", () => {
  it("lists the stage's points in order and its respecs as text", async () => {
    await renderTree();
    const order = screen.getByRole("region", { name: "Second Wind" });
    const items = within(order).getAllByRole("button");
    expect(items.map((b) => b.textContent)).toEqual([
      "01Made-up NotableNotable",
      "02Made-up KeystoneKeystone",
      "×Node bPassive",
    ]);
    expect(screen.getByText("Respec", { selector: "p" })).toBeTruthy();
  });

  it("passes the allocation of the cursor to the renderer", async () => {
    await renderTree();
    const last = calls.highlights.at(-1) as { allocated: Set<string>; refunded: Set<string> };
    expect([...last.allocated].sort()).toEqual(["a", "k", "n"]);
    expect([...last.refunded]).toEqual(["b"]);
  });

  it("moves through stages with the timeline", async () => {
    await renderTree();
    fireEvent.click(screen.getByRole("button", { name: /First Steps/ }));
    expect(screen.getByRole("region", { name: "First Steps" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Passive points allocated"), { target: { value: "1" } });
    const order = screen.getByRole("region", { name: "First Steps" });
    expect(within(order).getAllByRole("button")).toHaveLength(1);
  });

  it("finds passives by name or stat text", async () => {
    await renderTree();
    fireEvent.change(screen.getByPlaceholderText("Search passives"), {
      target: { value: "keystone" },
    });
    expect(screen.getByText("1 found")).toBeTruthy();
    const last = calls.highlights.at(-1) as { matches: Set<string> };
    expect([...last.matches]).toEqual(["k"]);
  });

  it("shows a failing renderer as an error, not as an empty tree", async () => {
    calls.fail = true;
    await renderTree();
    expect(screen.getByRole("alert").textContent).toContain("WebGL unavailable");
  });

  it("turns a lost graphics context into a visible error", async () => {
    await renderTree();
    act(() => calls.onError?.(new Error("The graphics context was lost (WebGL)")));
    expect(screen.getByRole("alert").textContent).toContain("graphics context was lost");
  });

  it("plays the stage point by point and stops at its end", async () => {
    await renderTree(0);
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Play allocation of this stage" }));
    // restarts at the beginning of the stage it is in
    expect(
      within(screen.getByRole("region", { name: "First Steps" })).queryAllByRole("button"),
    ).toHaveLength(0);
    for (let i = 0; i < 3; i++) act(() => vi.advanceTimersByTime(120));
    expect(
      within(screen.getByRole("region", { name: "First Steps" })).getAllByRole("button"),
    ).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Play allocation of this stage" })).toBeTruthy();
  });

  it("frames a passive picked from the list and pans with the keyboard", async () => {
    await renderTree();
    fireEvent.click(screen.getByRole("button", { name: /Made-up Keystone/ }));
    expect(calls.fits.at(-1)).toEqual([["k"], 0.2, 2600]);
    expect(calls.focus.at(-1)).toBe("k");
    fireEvent.keyDown(screen.getByRole("application"), { key: "ArrowLeft" });
    expect(calls.pans.at(-1)).toEqual([80, 0]);
  });

  it("names passives of the plan that the data release does not have", async () => {
    const broken = buildTimeline([
      {
        key: "s1",
        label: "Lost",
        levelRange: [1, 2],
        allocationOrder: ids(["ghost"]),
        respecs: ids([]),
      },
    ]);
    render(
      <PassiveTree
        view={view}
        timeline={broken}
        provenance={{ kind: "gamedata", dataRelease: "fake+r1" }}
        allocationSource="Allocation: test fixture"
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Passive ghost is not in this data release.")).toBeTruthy();
  });
});
