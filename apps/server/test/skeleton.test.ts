import { describe, expect, it, vi } from "vitest";
import type { TreeOptimizeInput } from "@exileforge/optimizer";
import {
  ArchetypeCandidate,
  BuildRequest,
  BuildState,
  SkillProfile,
} from "@exileforge/contracts/build";
import { CatalogShard } from "@exileforge/contracts/catalog";
import { CalcId } from "@exileforge/contracts/common";
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

function setup(optimizeResult: object) {
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
    catalog,
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
    logger: createMemoryLogger(),
    optimize,
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
