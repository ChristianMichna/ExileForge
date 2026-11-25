import { describe, expect, it } from "vitest";
import { GROUPS, node, sampleTree } from "./fixtures.test-util";
import { arcBetween, buildTreeView } from "./tree-model";

describe("buildTreeView", () => {
  const view = buildTreeView(sampleTree(), GROUPS, { include: (n) => !n.ascendancyId });

  it("maps catalog kinds to shapes; class starts by classStartFor", () => {
    expect(view.nodes.get("S")?.shape).toBe("classStart");
    expect(view.nodes.get("n")?.shape).toBe("notable");
    expect(view.nodes.get("k")?.shape).toBe("keystone");
    expect(view.nodes.get("d")?.shape).toBe("decoration");
    expect(view.issues).toEqual([]);
  });

  it("draws each connection once, as arc where the release says so", () => {
    const ab = view.edges.find((e) => e.a === "a" && e.b === "b");
    expect(ab?.arc).toMatchObject({ cx: 0, cy: 0, r: 100 });
    expect(view.edges.filter((e) => e.a === "b" || e.b === "b")).toHaveLength(2);
  });

  it("marks edges into a class start instead of drawing them like others", () => {
    expect(view.edges.find((e) => e.a === "S")).toMatchObject({ b: "a", classStart: true });
    expect(view.neighbours.get("S")).toEqual(["a"]);
  });

  it("filters nodes and leaves out edges across ascendancies", () => {
    expect(view.nodes.has("x1")).toBe(false);
    const all = buildTreeView(sampleTree(), GROUPS);
    expect(all.edges.find((e) => e.a === "x2" && e.b === "b")).toBeUndefined();
    expect(all.edges.find((e) => e.a === "x1" && e.b === "x2")).toBeDefined();
  });

  it("takes the arc from the other end when only that one carries it", () => {
    const withBack = [
      node({
        id: "p",
        x: 0,
        y: -100,
        connections: ["q"],
        arcs: [{ to: "q", center: { x: 0, y: 0 }, radius: 100 }],
      }),
      node({ id: "q", x: 100, y: 0, connections: ["p"] }),
    ];
    const v = buildTreeView(withBack, GROUPS);
    expect(v.edges).toHaveLength(1);
    expect(v.edges[0]?.arc).toBeDefined();
  });

  it("lists nodes without position and unknown kinds instead of drawing them at 0,0", () => {
    const broken = node({ id: "z", kind: "mystery" });
    const noPoint = node({ id: "y", placed: false });
    const v = buildTreeView([broken, noPoint], GROUPS);
    expect(v.nodes.has("y")).toBe(false);
    expect(v.nodes.get("z")?.shape).toBe("small");
    expect(v.issues).toEqual([
      'Node z has kind "mystery" without a shape; drawn as small node',
      "Node y (Node y) has no position in this data release",
    ]);
  });

  it("computes bounds over drawn nodes", () => {
    expect(view.bounds).toEqual({ minX: -200, minY: -100, maxX: 1000, maxY: 0 });
  });
});

describe("arcBetween", () => {
  it("takes the short way round", () => {
    const quarter = arcBetween({ x: 100, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 0 }, 100);
    expect(quarter.anticlockwise).toBe(false);
    const back = arcBetween({ x: 0, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 0 }, 100);
    expect(back.anticlockwise).toBe(true);
    // across the ±π seam
    const seam = arcBetween({ x: -100, y: -1 }, { x: -100, y: 1 }, { x: 0, y: 0 }, 100);
    expect(seam.anticlockwise).toBe(true);
  });
});
