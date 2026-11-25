import type {
  BuildHandle,
  CalcMethodName,
  CalcParams,
  CalcProfileId,
  CalcResult,
  CalcResultOf,
  PassiveNodeId,
} from "@exileforge/contracts";
import { describe, expect, it } from "vitest";
import { createPobTreeEvaluator, TreePatchDivergedError } from "../src/index.ts";

const handle = "h-base" as BuildHandle;
const profile = "fixture-profile" as CalcProfileId;
const ids = (...s: string[]): PassiveNodeId[] => s as PassiveNodeId[];

function result(stats: Record<string, number>, calcId: string): CalcResult {
  return {
    calcId,
    pobVersion: "0.0.0",
    dataReleaseId: "fixture+r1",
    calcProfile: profile,
    inputHash: "0".repeat(64),
    computedAt: "2026-01-01T00:00:00Z",
    stats,
    warnings: [],
    unsupportedMods: [],
  } as unknown as CalcResult;
}

class FakePool {
  calls: { method: string; params: unknown }[] = [];
  patchWarnings: string[] = [];
  nodePowerError: unknown;
  request<M extends CalcMethodName>(method: M, params: CalcParams<M>): Promise<CalcResultOf<M>> {
    this.calls.push({ method, params });
    const out = this.answer(method, params as never);
    return out instanceof Error ? Promise.reject(out) : Promise.resolve(out as CalcResultOf<M>);
  }
  private answer(method: string, params: Record<string, unknown>): unknown {
    switch (method) {
      case "calc.stats":
        return result({ Life: 100, Dps: 50 }, params["handle"] === handle ? "base" : "patched");
      case "calc.evalBatch": {
        const candidates = params["candidates"] as { key: string }[];
        return {
          base: result({ Life: 100, Dps: 50 }, "base"),
          results: candidates.map((c) =>
            c.key === "1"
              ? { key: c.key, ok: false, error: { kind: "calc_failed", detail: "boom" } }
              : { key: c.key, ok: true, calcId: `c${c.key}`, deltas: { Life: 5, Dps: -2 } },
          ),
        };
      }
      case "build.applyPatch":
        return { handle: "h-temp", warnings: this.patchWarnings };
      case "build.release":
        return {};
      case "calc.nodePower":
        return this.nodePowerError instanceof Error
          ? this.nodePowerError
          : {
              base: result({ Life: 100 }, "base"),
              results: [{ nodeId: "n1", calcId: "x", deltas: { Life: 3 }, pathCost: 2 }],
            };
      default:
        return new Error(`unexpected ${method}`);
    }
  }
}

describe("createPobTreeEvaluator", () => {
  it("turns states into patch ops and adds deltas to the base values", async () => {
    const pool = new FakePool();
    const evaluator = createPobTreeEvaluator({
      pool,
      handle,
      profile,
      baseAllocated: ids("a", "b"),
    });
    const out = await evaluator.evaluate(
      [ids("a", "b", "c"), ids("a", "d"), ids("a", "b")],
      ["Life", "Dps"],
    );
    const batch = pool.calls.find((c) => c.method === "calc.evalBatch")?.params as {
      candidates: { key: string; ops: unknown[] }[];
    };
    expect(batch.candidates[0]?.ops).toEqual([{ op: "allocateNodes", nodeIds: ["c"] }]);
    expect(batch.candidates[1]?.ops).toEqual([
      { op: "deallocateNodes", nodeIds: ["b"] },
      { op: "allocateNodes", nodeIds: ["d"] },
    ]);
    expect(out[0]).toEqual({ ok: true, metrics: { Life: 105, Dps: 48 }, calcId: "c0" });
    expect(out[1]).toEqual({ ok: false, error: { kind: "calc_failed", detail: "boom" } });
    // Unchanged state: the loaded build's own result.
    expect(out[2]).toEqual({ ok: true, metrics: { Life: 100, Dps: 50 }, calcId: "base" });
  });

  it("sends the player's overrides with every calculation, and none when there are none", async () => {
    const overrides = { enemyIsBoss: "Uber" };
    const pool = new FakePool();
    const evaluator = createPobTreeEvaluator({
      pool,
      handle,
      profile,
      baseAllocated: ids("a"),
      overrides,
    });
    await evaluator.evaluate([ids("a", "c"), ids("a")], ["Life"]);
    await evaluator.nodePower?.(ids("a", "b"), ids("n1"), ["Life"]);
    await evaluator.confirm?.(ids("a", "b"), ["Life"]);
    const calcs = pool.calls.filter((c) => c.method.startsWith("calc."));
    expect(calcs.map((c) => c.method).sort()).toEqual([
      "calc.evalBatch",
      "calc.nodePower",
      "calc.stats",
      "calc.stats",
    ]);
    for (const call of calcs) {
      expect((call.params as { overrides?: unknown }).overrides).toEqual(overrides);
    }
    const plainPool = new FakePool();
    await createPobTreeEvaluator({
      pool: plainPool,
      handle,
      profile,
      baseAllocated: ids("a"),
    }).evaluate([ids("a", "c")], ["Life"]);
    expect(JSON.stringify(plainPool.calls)).not.toContain("overrides");
  });

  it("marks a metric PoB does not report as failure", async () => {
    const pool = new FakePool();
    const evaluator = createPobTreeEvaluator({ pool, handle, profile, baseAllocated: ids("a") });
    const [out] = await evaluator.evaluate([ids("a", "c")], ["Life", "Missing"]);
    expect(out).toMatchObject({ ok: false, error: { kind: "missing_metric" } });
  });

  it("returns undefined node power when the worker lacks the method", async () => {
    const pool = new FakePool();
    pool.nodePowerError = Object.assign(new Error("no"), { kind: "unknown_method" });
    const evaluator = createPobTreeEvaluator({ pool, handle, profile, baseAllocated: ids("a") });
    expect(await evaluator.nodePower?.(ids("a"), undefined, ["Life"])).toBeUndefined();
  });

  it("rethrows other node power errors and releases temporary handles", async () => {
    const pool = new FakePool();
    pool.nodePowerError = Object.assign(new Error("crash"), { kind: "worker_crashed" });
    const evaluator = createPobTreeEvaluator({ pool, handle, profile, baseAllocated: ids("a") });
    await expect(evaluator.nodePower?.(ids("a", "b"), undefined, ["Life"])).rejects.toThrow(
      "crash",
    );
    expect(pool.calls.at(-1)?.method).toBe("build.release");
  });

  it("maps node power results", async () => {
    const pool = new FakePool();
    const evaluator = createPobTreeEvaluator({ pool, handle, profile, baseAllocated: ids("a") });
    expect(await evaluator.nodePower?.(ids("a"), undefined, ["Life"])).toEqual([
      { nodeId: "n1", deltas: { Life: 3 }, pathCost: 2 },
    ]);
  });

  it("confirmResult throws when PoB reports patch warnings", async () => {
    const pool = new FakePool();
    pool.patchWarnings = ["node not reachable"];
    const evaluator = createPobTreeEvaluator({ pool, handle, profile, baseAllocated: ids("a") });
    await expect(evaluator.confirmResult(ids("a", "b"))).rejects.toBeInstanceOf(
      TreePatchDivergedError,
    );
    expect(pool.calls.at(-1)?.method).toBe("build.release");
  });

  it("confirmResult returns the full result of the patched state", async () => {
    const pool = new FakePool();
    const evaluator = createPobTreeEvaluator({ pool, handle, profile, baseAllocated: ids("a") });
    const confirmed = await evaluator.confirmResult(ids("a", "b"));
    expect(confirmed.calcId).toBe("patched");
    expect(pool.calls.map((c) => c.method)).toEqual([
      "build.applyPatch",
      "calc.stats",
      "build.release",
    ]);
  });
});
