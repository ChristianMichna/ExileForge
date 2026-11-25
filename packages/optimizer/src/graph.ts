import type { PassiveNode, PassiveNodeId } from "@exileforge/contracts";
import { OptimizerError } from "./errors.ts";

/**
 * The main passive tree as an undirected graph for one class. Ascendancy
 * nodes and the start nodes of other classes are not part of it: pathing runs
 * through neither (ascendancy points are a separate allocation).
 */
export class TreeGraph {
  readonly start: string;
  private readonly adjacency: ReadonlyMap<string, readonly string[]>;

  private constructor(start: string, adjacency: Map<string, string[]>) {
    this.start = start;
    this.adjacency = adjacency;
  }

  static build(nodes: readonly PassiveNode[], startNodeId: PassiveNodeId): TreeGraph {
    const traversable = new Map<string, PassiveNode>();
    for (const node of nodes) {
      if (node.ascendancyId !== undefined) continue;
      if (node.classStartFor.length > 0 && node.id !== startNodeId) continue;
      traversable.set(node.id, node);
    }
    if (!traversable.has(startNodeId)) {
      throw new OptimizerError("invalid_input", `Start node ${startNodeId} is not in the tree`);
    }
    const sets = new Map<string, Set<string>>();
    for (const id of traversable.keys()) sets.set(id, new Set());
    for (const node of traversable.values()) {
      for (const other of node.connections) {
        if (!traversable.has(other) || other === node.id) continue;
        sets.get(node.id)?.add(other);
        sets.get(other)?.add(node.id);
      }
    }
    const adjacency = new Map<string, string[]>();
    for (const [id, set] of sets) adjacency.set(id, [...set].sort());
    return new TreeGraph(startNodeId, adjacency);
  }

  has(id: string): boolean {
    return this.adjacency.has(id);
  }

  neighbors(id: string): readonly string[] {
    return this.adjacency.get(id) ?? [];
  }

  ids(): IterableIterator<string> {
    return this.adjacency.keys();
  }

  /** Number of nodes in the graph (for tests and sanity checks). */
  get size(): number {
    return this.adjacency.size;
  }

  /**
   * Breadth-first search from `sources` through nodes not in `blocked`.
   * Returns distance (in new nodes) and parent for every reached node up to
   * `maxDistance`. Deterministic: sources and neighbors are visited sorted.
   */
  search(
    sources: ReadonlySet<string>,
    blocked: ReadonlySet<string>,
    maxDistance: number,
  ): Map<string, { distance: number; parent: string }> {
    const reached = new Map<string, { distance: number; parent: string }>();
    let layer = [...sources].filter((s) => this.has(s)).sort();
    const seen = new Set(layer);
    for (let distance = 1; distance <= maxDistance && layer.length > 0; distance++) {
      const next: string[] = [];
      for (const from of layer) {
        for (const to of this.neighbors(from)) {
          if (seen.has(to) || blocked.has(to)) continue;
          seen.add(to);
          reached.set(to, { distance, parent: from });
          next.push(to);
        }
      }
      layer = next.sort();
    }
    return reached;
  }

  /** Nodes to allocate to reach `target`, ordered from the allocated side to the target. */
  pathTo(
    target: string,
    reached: ReadonlyMap<string, { distance: number; parent: string }>,
  ): string[] {
    const path: string[] = [];
    let at: string | undefined = target;
    while (at !== undefined) {
      const step = reached.get(at);
      if (step === undefined) break;
      path.push(at);
      at = step.parent;
    }
    return path.reverse();
  }

  /** Whether every node of `nodes` is connected to the start through nodes of `nodes`. */
  isConnected(nodes: ReadonlySet<string>): boolean {
    const seen = new Set<string>([this.start]);
    const stack = [this.start];
    while (stack.length > 0) {
      const from = stack.pop() as string;
      for (const to of this.neighbors(from)) {
        if (nodes.has(to) && !seen.has(to)) {
          seen.add(to);
          stack.push(to);
        }
      }
    }
    for (const node of nodes) if (!seen.has(node)) return false;
    return true;
  }
}
