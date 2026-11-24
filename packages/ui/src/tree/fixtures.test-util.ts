// Invented tree for tests: names, stats and geometry are made up.
import { PassiveGroup, PassiveNode } from "@exileforge/contracts/catalog";

interface NodeInput {
  readonly id: string;
  readonly x?: number;
  readonly y?: number;
  readonly group?: string;
  readonly kind?: string;
  readonly name?: string;
  readonly connections?: string[];
  readonly arcs?: { to: string; center: { x: number; y: number }; radius: number }[];
  readonly classStartFor?: string[];
  readonly ascendancyId?: string;
  /** false leaves the node without position */
  readonly placed?: boolean;
}

/** Builds a node through the contract schema (brands ids, checks the shape). */
export function node({
  id,
  x = 0,
  y = 0,
  group = "g1",
  placed = true,
  ...rest
}: NodeInput): PassiveNode {
  return PassiveNode.parse({
    name: `Node ${id}`,
    kind: "small",
    stats: [{ text: `Made-up stat of ${id}` }],
    position: { groupId: group, orbit: 1, orbitIndex: 0, ...(placed ? { point: { x, y } } : {}) },
    connections: [],
    ...rest,
    id,
  });
}

export const GROUPS: PassiveGroup[] = [
  { id: "g1", center: { x: 0, y: 0 }, orbitRadii: [0, 100] },
  { id: "g2", center: { x: 1000, y: 0 }, orbitRadii: [0] },
].map((g) => PassiveGroup.parse(g));

/** start S – a – b (arc around g1) – n (notable) – k (keystone); x: ascendancy pair. */
export function sampleTree(): PassiveNode[] {
  return [
    node({ id: "S", x: -200, classStartFor: ["Fakeclass"], connections: ["a"] }),
    node({
      id: "a",
      x: 0,
      y: -100,
      connections: ["b"],
      arcs: [{ to: "b", center: { x: 0, y: 0 }, radius: 100 }],
    }),
    node({ id: "b", x: 100, y: 0, connections: ["n"] }),
    node({ id: "n", x: 300, y: 0, kind: "notable", name: "Made-up Notable", connections: ["k"] }),
    node({ id: "k", x: 1000, y: 0, group: "g2", kind: "keystone", name: "Made-up Keystone" }),
    node({ id: "d", x: 0, y: 0, kind: "decoration" }),
    node({
      id: "x1",
      x: 5000,
      y: 0,
      ascendancyId: "Fake1",
      kind: "ascendancyStart",
      connections: ["x2"],
    }),
    node({ id: "x2", x: 5100, y: 0, ascendancyId: "Fake1", connections: ["b"] }),
  ];
}
