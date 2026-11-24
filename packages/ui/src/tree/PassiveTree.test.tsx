import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GROUPS, sampleTree } from "./fixtures.test-util";
import { PassiveTree } from "./PassiveTree";
import { buildTreeView } from "./tree-model";
import { buildTimeline } from "./tree-timeline";

// WebGL is not available in jsdom: the renderer is replaced by a recorder.
const calls = vi.hoisted(() => ({
  highlights: [] as unknown[],
  fits: [] as unknown[],
  fail: false,
}));
vi.mock("./renderer", () => ({
  TreeRenderer: {
    create: () => {
      if (calls.fail) return Promise.reject(new Error("WebGL context lost"));
      return Promise.resolve({
        setHighlight: (h: unknown) => calls.highlights.push(h),
        fit: (...args: unknown[]) => calls.fits.push(args),
        zoomBy: () => undefined,
        panBy: () => undefined,
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
    allocationOrder: ["a", "b"],
    respecs: [],
  },
  {
    key: "s2",
    label: "Second Wind",
    levelRange: [11, 20],
    allocationOrder: ["n", "k"],
    respecs: ["b"],
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
  calls.fail = false;
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
    expect(screen.getByRole("alert").textContent).toContain("WebGL context lost");
  });

  it("names passives of the plan that the data release does not have", async () => {
    const broken = buildTimeline([
      { key: "s1", label: "Lost", levelRange: [1, 2], allocationOrder: ["ghost"], respecs: [] },
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
