import { describe, expect, it, vi } from "vitest";
import type { TreeOptimizeInput } from "@astrolabe/optimizer";
import {
  ArchetypeCandidate,
  BuildRequest,
  BuildState,
  SkillProfile,
} from "@astrolabe/contracts/build";
import { CatalogShard } from "@astrolabe/contracts/catalog";
import { CalcId } from "@astrolabe/contracts/common";
import { MemoryCatalog } from "../src/catalog/memory-catalog.js";
import { PobSkeleton } from "../src/calc/skeleton.js";
import { createMemoryLogger } from "../src/logger.js";
import { RELEASE, REQUEST, SHARDS, candidate } from "./fixtures.js";

const node = (id: string, connections: string[], extra: object = {}) => ({
  id,
  name: id,
  kind: "small",
  stats: [],
  position: { groupId: "g", orbit: 0, orbitIndex: 0 },
  connections,
  ...extra,
});
const catalog = new MemoryCatalog(RELEASE, [
  ...SHARDS,
  CatalogShard.parse({
    schemaVersion: 1,
    dataReleaseId: RELEASE,
    kind: "passiveNode",
    entities: [
      node("FixStartA", ["FixN1"], { classStartFor: ["FixClassA"] }),
      node("FixN1", ["FixStartA", "FixN2"]),
      node("FixN2", ["FixN1"]),
    ],
  }),
]);

const profile = SkillProfile.parse({
  mainSkillId: "FixGemMain",
  tags: [],
  scalingStats: [],
  supportCandidates: ["FixGemSupport", "FixGemOther"],
  relevantUniques: [],
  relevantNodes: ["FixN2", "NotInTree"],
  ascendancyCandidates: [],
});
const cand = ArchetypeCandidate.parse(candidate("a", "FixClassA", "FixAscA1"));

function setup(optimizeResult: object, stagesResult?: object, usedCatalog = catalog) {
  const optimize = vi.fn<(input: TreeOptimizeInput) => Promise<never>>(() =>
    Promise.resolve(optimizeResult as never),
  );
  const withBuild = vi.fn((_state: unknown, fn: (h: string) => Promise<unknown>) => fn("handle-1"));
  const calculate = vi.fn(() =>
    Promise.resolve({ "as-saved": { status: "ok" as const, calcId: CalcId.parse("calc-1") } }),
  );
  const skeleton = new PobSkeleton({
    pob: { withBuild } as never,
    pool: { request: () => Promise.reject(new Error("not used")) } as never,
    calc: { engine: "pob", calculate, getResult: () => Promise.resolve(undefined) },
    catalog: usedCatalog,
    optimizerConfig: {} as never,
    settings: {
      level: 10,
      passivePoints: 2,
      gemLevel: 1,
      supportCount: 1,
      calcProfiles: ["as-saved"],
      objective: { weights: { FullDPS: 1 }, floors: {} },
    },
    target: { calcProfiles: ["as-saved"], objective: { weights: { FullDPS: 1 }, floors: {} } },
    progression: { calcProfiles: ["as-saved"], objective: { weights: { FullDPS: 1 }, floors: {} } },
    logger: createMemoryLogger(),
    optimize,
    optimizeStages: (() => Promise.resolve(stagesResult as never)) as never,
  });
  return { skeleton, optimize, withBuild, calculate };
}

describe("PobSkeleton", () => {
  it("builds the empty skeleton, optimises within the budget and measures the result", async () => {
    const { skeleton, optimize, withBuild, calculate } = setup({
      allocated: ["FixN1", "FixN2"],
      feasible: true,
      violations: [],
      failedEvaluationCount: 0,
      failedEvaluations: [],
      stoppedBy: "budget_spent",
    });
    const out = await skeleton.evaluate({ request: REQUEST, profile, candidate: cand });

    const start = withBuild.mock.calls[0]?.[0] as {
      skills: { supports: unknown[] }[];
      level: number;
    };
    expect(start.level).toBe(10);
    expect(start.skills[0]?.supports).toHaveLength(1);
    const call = optimize.mock.calls[0]?.[0];
    expect(call).toMatchObject({ budget: 2, objective: { weights: { FullDPS: 1 } } });
    expect(call?.priorityNodeIds).toEqual(["FixN2"]);
    expect(out.skeleton.tree.allocated.map((n) => n.nodeId)).toEqual(["FixN1", "FixN2"]);
    expect(out.calcs).toEqual({ "as-saved": { status: "ok", calcId: "calc-1" } });
    expect(calculate).toHaveBeenCalledOnce();
  });

  describe("optimizeProgression (S6)", () => {
    const target = {
      candidateKey: "a",
      state: BuildState.parse({
        classId: "FixClassA",
        level: 20,
        tree: { allocated: [{ nodeId: "FixN1" }, { nodeId: "FixN2" }] },
        skills: [],
        items: [],
      }),
      calcs: {},
      rationale: [],
    } as never;
    const stage = (key: string, allocated: string[], feasible = true) => ({
      key,
      budget: allocated.length,
      allocated,
      allocationOrder: allocated,
      respecs: [],
      unspent: 0,
      metrics: {},
      calcId: "calc-1",
      violations: feasible ? [] : [{ stat: "x" }],
      feasible,
      stoppedBy: "budget_spent",
    });
    const input = {
      request: REQUEST,
      profile,
      candidate: cand,
      target,
      stages: [
        { key: "early", budget: 1, level: 10 },
        { key: "late", budget: 2, level: 20 },
      ],
    };
    const wrap = (stages: object[]) => ({
      stages,
      evaluations: 3,
      failedEvaluations: [],
      failedEvaluationCount: 0,
    });

    it("returns nested stage builds with a measurement each", async () => {
      const { skeleton, calculate } = setup(
        {},
        wrap([stage("early", ["FixN1"]), stage("late", ["FixN1", "FixN2"])]),
      );
      const out = await skeleton.optimizeProgression(input);
      expect(out.map((s) => [s.key, s.state.tree.allocated.length])).toEqual([
        ["early", 1],
        ["late", 2],
      ]);
      expect(calculate).toHaveBeenCalledTimes(2);
      expect(out.map((s) => s.state.level)).toEqual([10, 20]);
    });

    it("fails when the last stage does not reach the target tree", async () => {
      const { skeleton } = setup({}, wrap([stage("early", ["FixN1"]), stage("late", ["FixN1"])]));
      await expect(skeleton.optimizeProgression(input)).rejects.toThrow(/target nodes/);
    });

    it("fails visibly when a stage misses the floors", async () => {
      const { skeleton } = setup(
        {},
        wrap([stage("early", ["FixN1"], false), stage("late", ["FixN1", "FixN2"])]),
      );
      await expect(skeleton.optimizeProgression(input)).rejects.toThrow(/floors/);
    });
  });

  describe("optimizeTree (S5)", () => {
    const state = BuildState.parse({
      classId: "FixClassA",
      level: 20,
      tree: { allocated: [] },
      skills: [],
      items: [],
    });
    const done = {
      allocated: ["FixN1", "FixN2"],
      feasible: true,
      violations: [],
      failedEvaluationCount: 0,
      failedEvaluations: [],
      stoppedBy: "budget_spent",
    };
    const input = { request: REQUEST, profile, candidate: cand, state, passivePoints: 7 };

    it("optimises within the target budget and measures the tree", async () => {
      const { skeleton, optimize } = setup(done);
      const out = await skeleton.optimizeTree(input);
      expect(optimize.mock.calls[0]?.[0]).toMatchObject({ budget: 7 });
      expect(out.state.level).toBe(20);
      expect(out.state.tree.allocated.map((n) => n.nodeId)).toEqual(["FixN1", "FixN2"]);
      expect(out.calcs["as-saved"]?.status).toBe("ok");
    });

    it("searches the ascendancy on top of the main tree with the release's points", async () => {
      const ascShard = (shard: (typeof SHARDS)[number]): unknown =>
        shard.kind === "ascendancy"
          ? {
              ...shard,
              entities: shard.entities.map((e) =>
                e.id === "FixAscA1"
                  ? { ...e, startNodeId: "FixAscStart", nodeIds: ["FixAscStart", "FixAsc1"] }
                  : e,
              ),
            }
          : shard;
      const withAscendancy = new MemoryCatalog(RELEASE, [
        ...(SHARDS.map(ascShard) as never as typeof SHARDS),
        CatalogShard.parse({
          schemaVersion: 1,
          dataReleaseId: RELEASE,
          kind: "passiveNode",
          entities: [
            node("FixStartA", ["FixN1"], { classStartFor: ["FixClassA"] }),
            node("FixN1", ["FixStartA", "FixN2"]),
            node("FixN2", ["FixN1"]),
            node("FixAscStart", ["FixAsc1"], { ascendancyId: "FixAscA1" }),
            node("FixAsc1", ["FixAscStart"], { ascendancyId: "FixAscA1" }),
          ],
        }),
      ]);
      const { skeleton, optimize, withBuild } = setup(done, undefined, withAscendancy);
      optimize.mockResolvedValueOnce(done as never);
      optimize.mockResolvedValueOnce({ ...done, allocated: ["FixAsc1"] } as never);
      const out = await skeleton.optimizeTree({ ...input, ascendancyPoints: 3 });
      expect(optimize).toHaveBeenCalledTimes(2);
      expect(optimize.mock.calls[1]?.[0]).toMatchObject({ budget: 3 });
      expect([...(optimize.mock.calls[1]?.[0].graph.ids() ?? [])].sort()).toEqual([
        "FixAsc1",
        "FixAscStart",
      ]);
      // the ascendancy search runs on a build that already has the main tree
      const loaded = withBuild.mock.calls[1]?.[0] as { tree: { allocated: unknown[] } };
      expect(loaded.tree.allocated).toHaveLength(2);
      expect(out.state.tree.ascendancy).toEqual(["FixAsc1"]);
      // without points there is no ascendancy search
      const plain = setup(done);
      await plain.skeleton.optimizeTree(input);
      expect(plain.optimize).toHaveBeenCalledTimes(1);
    });

    it("fails when the objective floors cannot be met", async () => {
      const { skeleton } = setup({ ...done, feasible: false, violations: [{ stat: "x" }] });
      await expect(skeleton.optimizeTree(input)).rejects.toThrow(/floors/);
    });

    it("fails for a request of another data release", async () => {
      const { skeleton } = setup(done);
      const request = BuildRequest.parse({ ...REQUEST, dataReleaseId: "poe2-1.0.0+r1" });
      await expect(skeleton.optimizeTree({ ...input, request })).rejects.toThrow(/catalog/);
    });
  });

  it("measures with the player's calc overrides", async () => {
    const { skeleton, calculate } = setup({
      allocated: [],
      feasible: true,
      violations: [],
      failedEvaluationCount: 0,
      failedEvaluations: [],
      stoppedBy: "budget_spent",
    });
    const request = BuildRequest.parse({ ...REQUEST, calcOverrides: { enemyIsBoss: "Uber" } });
    await skeleton.evaluate({ request, profile, candidate: cand });
    expect(calculate).toHaveBeenCalledWith(
      expect.objectContaining({ overrides: { enemyIsBoss: "Uber" } }),
    );
  });

  it("fails for a class without catalog entry and for a request of another release", async () => {
    const { skeleton } = setup({
      allocated: [],
      feasible: true,
      violations: [],
      failedEvaluationCount: 0,
      failedEvaluations: [],
      stoppedBy: "no_gain",
    });
    await expect(
      skeleton.evaluate({
        request: REQUEST,
        profile,
        candidate: ArchetypeCandidate.parse(candidate("b", "NoSuchClass", "FixAscA1")),
      }),
    ).rejects.toThrow(/NoSuchClass/);
    await expect(
      skeleton.evaluate({
        request: BuildRequest.parse({ ...REQUEST, dataReleaseId: "poe2-1.0.0+r1" }),
        profile,
        candidate: cand,
      }),
    ).rejects.toThrow(/targets/);
  });
});
