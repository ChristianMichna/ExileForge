import { describe, expect, it } from "vitest";
import {
  CALC_PROTOCOL_VERSION,
  CalcMethodName,
  CalcMethods,
  CalcRequest,
  CalcResponse,
  PatchOp,
  parseCalcParams,
  parseCalcResult,
} from "../src/index.js";
import { without } from "./helpers.js";

const calcResult = {
  calcId: "calc-1",
  pobVersion: "v9.9.9",
  dataReleaseId: "poe2-9.8.7+r3",
  calcProfile: "fixture-profile",
  inputHash: "a".repeat(64),
  computedAt: "2026-01-01T00:00:00Z",
  stats: { FixtureStatA: 1, FixtureStatB: 2.5 },
  warnings: [],
  unsupportedMods: ["Fixture unsupported line"],
};

describe("CalcMethods", () => {
  it("covers the RPC methods of the plan", () => {
    expect(Object.keys(CalcMethods).sort()).toEqual(
      [
        "build.applyPatch",
        "build.export",
        "build.load",
        "build.release",
        "calc.evalBatch",
        "calc.itemPower",
        "calc.nodePower",
        "calc.stats",
        "calc.validate",
        "meta.version",
      ].sort(),
    );
    expect(CalcMethodName.options).toHaveLength(Object.keys(CalcMethods).length);
  });

  it("meta.version reports the protocol version", () => {
    const v = parseCalcResult("meta.version", {
      protocolVersion: CALC_PROTOCOL_VERSION,
      pobVersion: "v9.9.9",
      gameVersion: "9.8.7",
      dataReleaseId: "poe2-9.8.7+r3",
    });
    expect(v.protocolVersion).toBe(CALC_PROTOCOL_VERSION);
  });
});

describe("params validation", () => {
  it("accepts a valid applyPatch", () => {
    const p = parseCalcParams("build.applyPatch", {
      handle: "h1",
      ops: [
        { op: "allocateNodes", nodeIds: ["fixture_node_1"], weaponSet: 1 },
        { op: "setItem", slot: "FixtureSlot", itemText: "Fixture item text" },
        { op: "setConfig", key: "fixtureKey", value: true },
      ],
    });
    expect(p.ops).toHaveLength(3);
  });

  it("throws with cause on invalid params", () => {
    let caught: unknown;
    try {
      parseCalcParams("calc.stats", { handle: "h1", profile: "Not A Profile" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).cause).toBeDefined();
  });

  it("rejects unknown patch ops and empty batches", () => {
    expect(PatchOp.safeParse({ op: "deleteEverything" }).success).toBe(false);
    expect(
      CalcMethods["calc.evalBatch"].params.safeParse({
        handle: "h1",
        profile: "fixture-profile",
        metrics: ["FixtureStatA"],
        candidates: [],
      }).success,
    ).toBe(false);
  });

  it("rejects oversized build payloads", () => {
    const r = CalcMethods["build.load"].params.safeParse({
      format: "code",
      payload: "x".repeat(2_000_001),
    });
    expect(r.success).toBe(false);
  });
});

describe("result validation", () => {
  it("accepts a calc result and keeps unsupported mods", () => {
    expect(parseCalcResult("calc.stats", calcResult).unsupportedMods).toHaveLength(1);
  });

  it("rejects a result without provenance", () => {
    expect(() => parseCalcResult("calc.stats", without(calcResult, "pobVersion"))).toThrow(
      /Invalid result for calc.stats/,
    );
  });

  it("rejects non-numeric stats instead of coercing", () => {
    expect(() =>
      parseCalcResult("calc.stats", { ...calcResult, stats: { FixtureStatA: "1" } }),
    ).toThrow();
  });

  it("evalBatch reports per-candidate failures explicitly", () => {
    const r = parseCalcResult("calc.evalBatch", {
      base: calcResult,
      results: [
        { key: "a", ok: true, calcId: "calc-2", deltas: { FixtureStatA: 0.5 } },
        { key: "b", ok: false, error: "patch failed" },
      ],
    });
    expect(r.results.map((x) => x.ok)).toEqual([true, false]);
  });
});

describe("JSON-RPC envelope", () => {
  it("accepts a request and both response shapes", () => {
    expect(
      CalcRequest.safeParse({ jsonrpc: "2.0", id: 1, method: "calc.stats", params: {} }).success,
    ).toBe(true);
    expect(CalcResponse.safeParse({ jsonrpc: "2.0", id: 1, result: {} }).success).toBe(true);
    expect(
      CalcResponse.safeParse({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "worker crashed", data: { kind: "worker_crashed" } },
      }).success,
    ).toBe(true);
  });

  it("rejects unknown methods and error kinds", () => {
    expect(
      CalcRequest.safeParse({ jsonrpc: "2.0", id: 1, method: "os.exec", params: {} }).success,
    ).toBe(false);
    expect(
      CalcResponse.safeParse({
        jsonrpc: "2.0",
        id: 1,
        error: { code: 1, message: "x", data: { kind: "made_up" } },
      }).success,
    ).toBe(false);
  });
});
