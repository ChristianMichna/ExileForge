import { describe, expect, it } from "vitest";
import { BuildState } from "@exileforge/contracts/build";
import type { CalcMethodName, CalcParams, CalcResult } from "@exileforge/contracts/calc";
import { CalcId, PobVersion, Sha256 } from "@exileforge/contracts/common";
import { PobCalc, type CalcRequester } from "../src/calc/pob-calc.js";
import { createMemoryLogger } from "../src/logger.js";
import { RELEASE } from "./fixtures.js";

const base = BuildState.parse({
  classId: "FixClassA",
  level: 1,
  tree: { allocated: [] },
  skills: [],
  items: [],
});
const wanted = BuildState.parse({ ...base, level: 20 });

/** Records calls; answers like the pool would. Values are test placeholders, not game data. */
function fakePool(
  options: { failStats?: boolean; patchWarnings?: string[]; failFirstLoad?: boolean } = {},
) {
  const calls: { method: string; params: unknown }[] = [];
  let handles = 0;
  const pool: CalcRequester = {
    async request<M extends CalcMethodName>(method: M, params: CalcParams<M>) {
      calls.push({ method, params });
      const answer = (v: unknown) => v as never;
      switch (method) {
        case "build.load":
          if (options.failFirstLoad && !calls.slice(0, -1).some((c) => c.method === "build.load")) {
            throw Object.assign(new Error("load failed"), { kind: "build_load_failed" });
          }
          return answer({ handle: `h${++handles}`, warnings: [] });
        case "build.applyPatch":
          return answer({ handle: `h${++handles}`, warnings: options.patchWarnings ?? [] });
        case "build.release":
          return answer({});
        case "calc.stats": {
          if (options.failStats) throw Object.assign(new Error("boom"), { kind: "calc_failed" });
          const result: CalcResult = {
            calcId: CalcId.parse(`calc-${(params as { handle: string }).handle}`),
            pobVersion: PobVersion.parse("v0.0.1-test"),
            dataReleaseId: RELEASE,
            calcProfile: (params as { profile: string }).profile,
            inputHash: Sha256.parse("a".repeat(64)),
            computedAt: "2026-01-01T00:00:00Z",
            stats: {},
            warnings: [],
            unsupportedMods: [],
          } as CalcResult;
          return answer(result);
        }
        default:
          throw new Error(`unexpected ${method}`);
      }
    },
  };
  return { pool, calls };
}

const bases = {
  baseFor: () => Promise.resolve({ format: "xml" as const, payload: "<x/>", state: base }),
};

describe("PobCalc", () => {
  it("patches the base to the wanted state, calculates per profile and releases the patched handle", async () => {
    const { pool, calls } = fakePool();
    const calc = new PobCalc({ pool, bases, logger: createMemoryLogger() });
    const out = await calc.calculate({ state: wanted, profiles: ["as-saved"] });
    expect(out["as-saved"]).toMatchObject({ status: "ok" });
    expect(calls.map((c) => c.method)).toEqual([
      "build.load",
      "build.applyPatch",
      "calc.stats",
      "build.release",
    ]);
    const ok = out["as-saved"];
    if (ok?.status !== "ok") throw new Error();
    expect((await calc.getResult(ok.calcId))?.calcProfile).toBe("as-saved");
  });

  it("calculates the base directly when nothing differs and loads each base once", async () => {
    const { pool, calls } = fakePool();
    const calc = new PobCalc({ pool, bases, logger: createMemoryLogger() });
    await calc.calculate({ state: base, profiles: ["as-saved"] });
    await calc.calculate({ state: base, profiles: ["as-saved"] });
    expect(calls.filter((c) => c.method === "build.load")).toHaveLength(1);
    expect(calls.some((c) => c.method === "build.applyPatch")).toBe(false);
  });

  it("reports failures as failed outcomes with the cause, never as values", async () => {
    const { pool } = fakePool({ failStats: true });
    const calc = new PobCalc({ pool, bases, logger: createMemoryLogger() });
    const out = await calc.calculate({ state: wanted, profiles: ["as-saved"] });
    expect(out["as-saved"]).toEqual({
      status: "failed",
      error: { code: "calc_failed", message: "boom" },
    });
  });

  it("fails every profile with patch_plan when the state needs an item renderer it lacks", async () => {
    const { pool } = fakePool();
    const withItem = BuildState.parse({
      ...base,
      items: [{ slot: "Weapon 1", item: { kind: "unique", uniqueId: "FixUnique" } }],
    });
    const calc = new PobCalc({ pool, bases, logger: createMemoryLogger() });
    const out = await calc.calculate({ state: withItem, profiles: ["as-saved", "other"] });
    expect(out["as-saved"]).toMatchObject({ status: "failed", error: { code: "patch_plan" } });
    expect(out["other"]).toMatchObject({ status: "failed", error: { code: "patch_plan" } });
  });

  it("fails when PoB reports patch warnings and still releases the patched handle", async () => {
    const { pool, calls } = fakePool({ patchWarnings: ["dropped node"] });
    const calc = new PobCalc({ pool, bases, logger: createMemoryLogger() });
    const out = await calc.calculate({ state: wanted, profiles: ["as-saved"] });
    expect(out["as-saved"]).toMatchObject({ status: "failed", error: { code: "patch_diverged" } });
    expect(calls.map((c) => c.method)).not.toContain("calc.stats");
    expect(calls.map((c) => c.method)).toContain("build.release");
  });

  it("releases the patched handle when calc.stats fails", async () => {
    const { pool, calls } = fakePool({ failStats: true });
    const calc = new PobCalc({ pool, bases, logger: createMemoryLogger() });
    await calc.calculate({ state: wanted, profiles: ["as-saved"] });
    expect(calls.at(-1)?.method).toBe("build.release");
  });

  it("does not cache a failed base load", async () => {
    const { pool, calls } = fakePool({ failFirstLoad: true });
    const calc = new PobCalc({ pool, bases, logger: createMemoryLogger() });
    const first = await calc.calculate({ state: base, profiles: ["as-saved"] });
    expect(first["as-saved"]).toMatchObject({
      status: "failed",
      error: { code: "build_load_failed" },
    });
    const second = await calc.calculate({ state: base, profiles: ["as-saved"] });
    expect(second["as-saved"]).toMatchObject({ status: "ok" });
    expect(calls.filter((c) => c.method === "build.load")).toHaveLength(2);
  });

  it("loads the base once for parallel calculations and refuses work after close", async () => {
    const { pool, calls } = fakePool();
    const calc = new PobCalc({ pool, bases, logger: createMemoryLogger() });
    await Promise.all([
      calc.calculate({ state: base, profiles: ["as-saved"] }),
      calc.calculate({ state: base, profiles: ["as-saved"] }),
    ]);
    expect(calls.filter((c) => c.method === "build.load")).toHaveLength(1);
    await calc.close();
    expect(calls.at(-1)?.method).toBe("build.release");
    await expect(calc.calculate({ state: base, profiles: ["as-saved"] })).rejects.toThrow(/closed/);
  });
});
