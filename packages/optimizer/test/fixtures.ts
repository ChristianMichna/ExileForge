import { PassiveNode, type PassiveNodeId } from "@astrolabe/contracts";
import { readFileSync } from "node:fs";
import type { OptimizerConfig } from "../src/config.ts";
import { parseOptimizerConfig } from "../src/config.ts";
import { TreeGraph } from "../src/graph.ts";
import type { EvalOutcome, NodePowerEntry, TreeEvaluator } from "../src/types.ts";

/*
 * Synthetic fixtures for logic tests: invented ids and fantasy stat values
 * (like calc-fake). No game content and no claim about real tree values.
 */

export const config: OptimizerConfig = parseOptimizerConfig(
  JSON.parse(readFileSync(new URL("../../../config/optimizer/tree.json", import.meta.url), "utf8")),
);

export interface FixtureNode {
  id: string;
  edges?: string[];
  ascendancy?: boolean;
  classStart?: boolean;
}

export function makeNodes(nodes: readonly FixtureNode[]): PassiveNode[] {
  return nodes.map((n, i) =>
    PassiveNode.parse({
      id: n.id,
      name: `node ${n.id}`,
      kind: "fixture-kind",
      stats: [],
      position: { groupId: "g", orbit: 0, orbitIndex: i },
      connections: n.edges ?? [],
      classStartFor: n.classStart ? ["fixture-class"] : [],
      ...(n.ascendancy ? { ascendancyId: "fixture-asc" } : {}),
    }),
  );
}

export function graphOf(nodes: readonly FixtureNode[], start = "start"): TreeGraph {
  return TreeGraph.build(makeNodes(nodes), start as PassiveNodeId);
}

/** Per-node fantasy contributions. */
export interface Stats {
  life?: number;
  dmg?: number;
  res?: number;
}

export interface FakeModel {
  stats: Readonly<Record<string, Stats>>;
  /** Extra damage multiplier when both nodes are allocated (non-additive interaction). */
  synergy?: readonly { a: string; b: string; mult: number }[];
  /** States (node sets) the fake engine cannot calculate. */
  failWhen?: (state: readonly string[]) => boolean;
}

export function fakeMetrics(model: FakeModel, state: readonly string[]): Record<string, number> {
  const set = new Set(state);
  let life = 100;
  let dmg = 100;
  let res = 0;
  for (const id of state) {
    life += model.stats[id]?.life ?? 0;
    dmg += model.stats[id]?.dmg ?? 0;
    res += model.stats[id]?.res ?? 0;
  }
  for (const s of model.synergy ?? []) if (set.has(s.a) && set.has(s.b)) dmg *= s.mult;
  return { Life: life, Dps: dmg, Res: res };
}

export class FakeEvaluator implements TreeEvaluator {
  calls = 0;
  evaluated = 0;
  nodePowerCalls = 0;

  constructor(
    readonly model: FakeModel,
    readonly options: { withNodePower?: boolean } = {},
  ) {
    if (options.withNodePower) {
      this.nodePower = (base, _candidates, metrics) => this.power(base, metrics);
    }
  }

  nodePower?: TreeEvaluator["nodePower"];

  private power(base: readonly string[], metrics: readonly string[]): Promise<NodePowerEntry[]> {
    this.nodePowerCalls++;
    const baseMetrics = fakeMetrics(this.model, base);
    const out: NodePowerEntry[] = [];
    for (const id of Object.keys(this.model.stats)) {
      if (base.includes(id)) continue;
      const m = fakeMetrics(this.model, [...base, id]);
      const deltas: Record<string, number> = {};
      for (const k of metrics) deltas[k] = (m[k] as number) - (baseMetrics[k] as number);
      out.push({ nodeId: id as PassiveNodeId, deltas, pathCost: 1 });
    }
    return Promise.resolve(out);
  }

  evaluate(
    states: readonly (readonly string[])[],
    metrics: readonly string[],
  ): Promise<EvalOutcome[]> {
    this.calls++;
    this.evaluated += states.length;
    return Promise.resolve(
      states.map((state): EvalOutcome => {
        if (this.model.failWhen?.(state)) {
          return { ok: false, error: { kind: "calc_failed", detail: "fixture failure" } };
        }
        const all = fakeMetrics(this.model, state);
        const picked: Record<string, number> = {};
        for (const m of metrics) if (all[m] !== undefined) picked[m] = all[m];
        return { ok: true, metrics: picked, calcId: `fake-${[...state].sort().join(",")}` };
      }),
    );
  }
}
