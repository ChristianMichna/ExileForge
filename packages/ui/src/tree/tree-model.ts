// Geometry of the passive tree for drawing, built from catalog entities.
// Positions and arcs come from the data release (PassiveNode.position.point,
// PassiveNode.arcs, PassiveGroup); nothing here knows game values. A node
// without a point is listed in `issues` and left out, never drawn at 0,0.
import type { PassiveGroup, PassiveNode } from "@astrolabe/contracts/catalog";

/** How a node is drawn. Own shapes, no game art. */
export type TreeNodeShape =
  | "small"
  | "attribute"
  | "notable"
  | "keystone"
  | "jewelSocket"
  | "classStart"
  | "ascendancyStart"
  | "decoration";

/**
 * Node kinds of the catalog (Astrolabe vocabulary from
 * config/data-pipeline/normalize.json) mapped to shapes. A kind not listed
 * here is drawn as a small node and reported in `issues`.
 */
const SHAPE_BY_KIND: Readonly<Record<string, TreeNodeShape>> = {
  small: "small",
  attribute: "attribute",
  notable: "notable",
  keystone: "keystone",
  jewelSocket: "jewelSocket",
  ascendancyStart: "ascendancyStart",
  decoration: "decoration",
};

export interface TreeNodeView {
  readonly id: string;
  readonly name: string;
  /** Catalog kind as given by the release. */
  readonly kind: string;
  readonly shape: TreeNodeShape;
  readonly x: number;
  readonly y: number;
  readonly groupId: string;
  readonly stats: readonly string[];
  readonly ascendancyId?: string;
  readonly classStartFor: readonly string[];
}

export interface TreeArc {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly start: number;
  readonly end: number;
  readonly anticlockwise: boolean;
}

export interface TreeEdgeView {
  readonly a: string;
  readonly b: string;
  readonly arc?: TreeArc;
  /**
   * Edge into a class start. The source tool draws none; here it appears
   * only once the other end is allocated, so the path visibly starts at the class.
   */
  readonly classStart?: true;
}

export interface TreeGroupView {
  readonly id: string;
  readonly cx: number;
  readonly cy: number;
  readonly radii: readonly number[];
}

export interface TreeBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface PassiveTreeView {
  readonly nodes: ReadonlyMap<string, TreeNodeView>;
  readonly edges: readonly TreeEdgeView[];
  readonly groups: readonly TreeGroupView[];
  readonly bounds: TreeBounds;
  /** Neighbours per node (drawn edges and connections to class starts). */
  readonly neighbours: ReadonlyMap<string, readonly string[]>;
  /** Data problems that keep parts of the tree from being drawn. */
  readonly issues: readonly string[];
}

export interface TreeViewOptions {
  /** Which nodes belong to this view, e.g. the main tree or one ascendancy. */
  readonly include?: (node: PassiveNode) => boolean;
}

function shapeOf(node: PassiveNode, issues: string[]): TreeNodeShape {
  if (node.classStartFor.length > 0) return "classStart";
  const shape = SHAPE_BY_KIND[node.kind];
  if (shape) return shape;
  issues.push(`Node ${node.id} has kind "${node.kind}" without a shape; drawn as small node`);
  return "small";
}

/** The shorter arc (at most half a circle) around `center` from one point to another. */
export function arcBetween(
  from: { x: number; y: number },
  to: { x: number; y: number },
  center: { x: number; y: number },
  radius: number,
): TreeArc {
  const start = Math.atan2(from.y - center.y, from.x - center.x);
  const end = Math.atan2(to.y - center.y, to.x - center.x);
  let delta = end - start;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  return { cx: center.x, cy: center.y, r: radius, start, end, anticlockwise: delta < 0 };
}

/**
 * Builds the drawable tree. Edges follow the release's connections, once per
 * pair; like the source tool, no edge is drawn between different
 * ascendancies, and edges into a class start are marked (see TreeEdgeView).
 */
export function buildTreeView(
  nodes: readonly PassiveNode[],
  groups: readonly PassiveGroup[],
  options: TreeViewOptions = {},
): PassiveTreeView {
  const issues: string[] = [];
  const views = new Map<string, TreeNodeView>();
  const sources = new Map<string, PassiveNode>();
  for (const node of nodes) {
    if (options.include && !options.include(node)) continue;
    const point = node.position.point;
    if (!point) {
      issues.push(`Node ${node.id} (${node.name}) has no position in this data release`);
      continue;
    }
    sources.set(node.id, node);
    views.set(node.id, {
      id: node.id,
      name: node.name,
      kind: node.kind,
      shape: shapeOf(node, issues),
      x: point.x,
      y: point.y,
      groupId: node.position.groupId,
      stats: node.stats.map((s) => s.text),
      ...(node.ascendancyId !== undefined ? { ascendancyId: node.ascendancyId } : {}),
      classStartFor: node.classStartFor,
    });
  }

  const edges: TreeEdgeView[] = [];
  const seen = new Set<string>();
  const neighbours = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
  };
  for (const node of sources.values()) {
    const from = views.get(node.id);
    if (!from) continue;
    for (const targetId of node.connections) {
      const to = views.get(targetId);
      if (!to || targetId === node.id) continue;
      const key = node.id < targetId ? `${node.id}|${targetId}` : `${targetId}|${node.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      link(node.id, targetId);
      if (from.ascendancyId !== to.ascendancyId) continue;
      const start = from.shape === "classStart" || to.shape === "classStart";
      // either end may carry the arc, depending on which side lists the connection
      const own = node.arcs.find((a) => a.to === targetId);
      const back = sources.get(targetId)?.arcs.find((a) => a.to === node.id);
      const arc = own
        ? arcBetween(from, to, own.center, own.radius)
        : back
          ? arcBetween(from, to, back.center, back.radius)
          : undefined;
      edges.push({
        a: node.id,
        b: targetId,
        ...(arc ? { arc } : {}),
        ...(start ? { classStart: true } : {}),
      });
    }
  }

  const usedGroups = new Set([...views.values()].map((n) => n.groupId));
  const groupViews: TreeGroupView[] = groups
    .filter((g) => usedGroups.has(g.id))
    .map((g) => ({ id: g.id, cx: g.center.x, cy: g.center.y, radii: g.orbitRadii }));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of views.values()) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }
  if (views.size === 0) {
    issues.push("No node of this view has a position");
    minX = minY = maxX = maxY = 0;
  }

  return {
    nodes: views,
    edges,
    groups: groupViews,
    bounds: { minX, minY, maxX, maxY },
    neighbours,
    issues,
  };
}
