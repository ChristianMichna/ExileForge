import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CharacterClassId,
  PassiveNodeId,
  type CalcMethodName,
  type CalcParams,
} from "@astrolabe/contracts";
import {
  CalcPool,
  CalcServiceError,
  decodeBuildCode,
  encodeBuildCode,
  loadCalcProfiles,
  type CalcPoolOptions,
  type PoolEvent,
} from "../src/index.ts";

const fixture = (p: string): string => fileURLToPath(new URL(`./fixtures/${p}`, import.meta.url));

const XML = '<PathOfBuilding2><Build level="1"/></PathOfBuilding2>';
const BASE_CONFIG: CalcPoolOptions["config"] = {
  startTimeoutMs: 10_000,
  requestTimeoutMs: 5_000,
  recycleAfterRequests: 1_000,
  maxStartFailures: 2,
  restartBackoffMs: 10,
  stopGraceMs: 1_000,
  luaGc: { pause: 150, stepmul: 200 },
};

const pools: CalcPool[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((p) => p.close()));
});

async function fakePool(
  overrides: Partial<CalcPoolOptions["config"]> = {},
  extra: Partial<CalcPoolOptions> = {},
): Promise<{ pool: CalcPool; events: PoolEvent[] }> {
  const events: PoolEvent[] = [];
  const pool = await CalcPool.start({
    install: {
      srcDir: fixture("fake-pob/src"),
      luajit: process.execPath,
      workerLua: fixture("fake-worker.mjs"),
    },
    profiles: await loadCalcProfiles(fixture("calc-profiles")),
    size: 1,
    config: { ...BASE_CONFIG, ...overrides },
    onEvent: (e) => events.push(e),
    ...extra,
  });
  pools.push(pool);
  return { pool, events };
}

async function expectKind(
  promise: Promise<unknown>,
  kind: CalcServiceError["kind"],
): Promise<void> {
  const err: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(CalcServiceError);
  expect((err as CalcServiceError).kind).toBe(kind);
}

/** Sends deliberately invalid params past the static types. */
function untyped<M extends CalcMethodName>(value: unknown): CalcParams<M> {
  return value as CalcParams<M>;
}

describe("CalcPool with the fake worker", () => {
  it("reports meta.version with the data hash and a local release id", async () => {
    const { pool } = await fakePool();
    const meta = await pool.request("meta.version", {});
    expect(meta.protocolVersion).toBe(1);
    expect(meta.dataReleaseId).toBe("poe2-0.5+r0");
    expect(meta.dataHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("loads XML and build codes and calculates with a profile", async () => {
    const { pool } = await fakePool();
    const fromXml = await pool.request("build.load", { format: "xml", payload: XML });
    const fromCode = await pool.request("build.load", {
      format: "code",
      payload: encodeBuildCode(XML),
    });
    expect(fromXml.handle).not.toBe(fromCode.handle);
    expect(fromXml.warnings).toEqual(["fake loaded w1"]);
    const a = await pool.request("calc.stats", { handle: fromXml.handle, profile: "as-saved" });
    const b = await pool.request("calc.stats", { handle: fromCode.handle, profile: "as-saved" });
    expect(a.inputHash).toBe(createHash("sha256").update(XML).digest("hex"));
    expect(b.inputHash).toBe(a.inputHash);
    expect(a.calcProfile).toBe("as-saved");
  });

  it("exports XML and build codes", async () => {
    const { pool } = await fakePool();
    const { handle } = await pool.request("build.load", { format: "xml", payload: XML });
    expect((await pool.request("build.export", { handle, format: "xml" })).payload).toBe(XML);
    const code = (await pool.request("build.export", { handle, format: "code" })).payload;
    expect(decodeBuildCode(code)).toBe(XML);
  });

  it("rejects invalid input with contract error kinds", async () => {
    const { pool } = await fakePool();
    const { handle } = await pool.request("build.load", { format: "xml", payload: XML });
    await expectKind(
      pool.request("calc.stats", untyped<"calc.stats">({ handle })),
      "invalid_params",
    );
    await expectKind(
      pool.request("calc.stats", { handle, profile: "no-such-profile" }),
      "invalid_params",
    );
    await expectKind(
      pool.request("calc.stats", untyped<"calc.stats">({ handle: "b999", profile: "as-saved" })),
      "unknown_handle",
    );
    await expectKind(
      pool.request(
        "calc.itemPower",
        untyped<"calc.itemPower">({
          handle,
          profile: "as-saved",
          metrics: ["X"],
          slot: "S",
          modLines: ["m"],
        }),
      ),
      "unknown_method",
    );
    await expectKind(
      pool.request("build.load", { format: "xml", payload: "<PathOfBuilding/>" }),
      "build_load_failed",
    );
    await expectKind(
      pool.request("build.load", { format: "code", payload: "%%%" }),
      "build_load_failed",
    );
  });

  it("serves patched states on every worker", async () => {
    const { pool } = await fakePool({}, { size: 2 });
    const { handle } = await pool.request("build.load", { format: "xml", payload: XML });
    const patched = await pool.request("build.applyPatch", {
      handle,
      ops: [{ op: "setLevel", level: 2 }],
    });
    expect(patched.handle).not.toBe(handle);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        pool.request("calc.stats", { handle: patched.handle, profile: "as-saved" }),
      ),
    );
    expect(new Set(results.map((r) => r.stats.FakePid)).size).toBe(2);
    expect(new Set(results.map((r) => r.inputHash)).size).toBe(1);
    const base = await pool.request("calc.stats", { handle, profile: "as-saved" });
    expect(results[0]?.inputHash).not.toBe(base.inputHash);
    await expectKind(
      pool.request("build.applyPatch", { handle, ops: [{ op: "setLevel", level: 101 }] }),
      "invalid_params",
    );
  });

  it("passes overrides on to the base and candidate calculations", async () => {
    const { pool } = await fakePool({}, { size: 2 });
    const { handle } = await pool.request("build.load", { format: "xml", payload: XML });
    const run = (overrides?: Record<string, boolean | number | string>) =>
      pool.request("calc.evalBatch", {
        handle,
        profile: "as-saved",
        ...(overrides === undefined ? {} : { overrides }),
        metrics: ["FakeLength"],
        candidates: [{ key: "lvl2", ops: [{ op: "setLevel", level: 2 }] }],
      });
    const plain = await run();
    const changed = await run({ enemyIsBoss: "Uber" });
    expect(plain.base.overrides).toBeUndefined();
    expect(changed.base.overrides).toEqual({ enemyIsBoss: "Uber" });
    expect(changed.base.calcId).not.toBe(plain.base.calcId);
    const first = plain.results[0];
    const second = changed.results[0];
    expect(first?.ok && second?.ok && first.calcId !== second.calcId).toBe(true);
  });

  it("evaluates candidates against a base and reports failures one by one", async () => {
    const { pool } = await fakePool({}, { size: 2 });
    const { handle } = await pool.request("build.load", { format: "xml", payload: XML });
    const res = await pool.request("calc.evalBatch", {
      handle,
      profile: "as-saved",
      metrics: ["FakeLength"],
      candidates: [
        { key: "lvl2", ops: [{ op: "setLevel", level: 2 }] },
        { key: "too-high", ops: [{ op: "setLevel", level: 101 }] },
        { key: "lvl3", ops: [{ op: "setLevel", level: 3 }] },
      ],
    });
    expect(res.base.stats.FakeLength).toBe(XML.length);
    expect(res.results.map((r) => r.key)).toEqual(["lvl2", "too-high", "lvl3"]);
    const [a, bad, c] = res.results;
    expect(a).toMatchObject({ ok: true });
    expect(a?.ok && a.deltas.FakeLength).toBeGreaterThan(0);
    expect(bad).toMatchObject({ ok: false, error: { kind: "invalid_params" } });
    expect(c).toMatchObject({ ok: true });
    // candidate states are temporary
    expect(pool.status().builds).toBe(1);
    await expectKind(
      pool.request("calc.evalBatch", {
        handle,
        profile: "as-saved",
        metrics: ["NoSuchMetric"],
        candidates: [{ key: "a", ops: [{ op: "setLevel", level: 2 }] }],
      }),
      "invalid_params",
    );
    const same = { key: "a", ops: [{ op: "setLevel" as const, level: 2 }] };
    await expectKind(
      pool.request("calc.evalBatch", {
        handle,
        profile: "as-saved",
        metrics: ["FakeLength"],
        candidates: [same, same],
      }),
      "invalid_params",
    );
  });

  it("fails single candidates for a missing metric or a failed calculation and cleans up", async () => {
    const { pool } = await fakePool({}, { size: 2 });
    const { handle } = await pool.request("build.load", { format: "xml", payload: XML });
    const res = await pool.request("calc.evalBatch", {
      handle,
      profile: "as-saved",
      metrics: ["FakeLength"],
      candidates: [
        { key: "no-metric", ops: [{ op: "setConfig", key: "dropMetric", value: true }] },
        { key: "calc-fails", ops: [{ op: "setConfig", key: "failCalc", value: true }] },
        { key: "fine", ops: [{ op: "setLevel", level: 2 }] },
      ],
    });
    expect(res.results[0]).toMatchObject({ ok: false, error: { kind: "calc_failed" } });
    expect(res.results[1]).toMatchObject({ ok: false, error: { kind: "calc_failed" } });
    expect(res.results[2]).toMatchObject({ ok: true });
    // the patched states of failed candidates are released as well
    expect(pool.status().builds).toBe(1);
    await expectKind(
      pool.request("calc.evalBatch", {
        handle,
        profile: "as-saved",
        metrics: ["constructor"],
        candidates: [{ key: "a", ops: [{ op: "setLevel", level: 2 }] }],
      }),
      "invalid_params",
    );
  });

  it("values reachable passives with their path cost", async () => {
    const { pool } = await fakePool({}, { size: 2 });
    const { handle } = await pool.request("build.load", { format: "xml", payload: XML });
    const all = await pool.request("calc.nodePower", {
      handle,
      profile: "as-saved",
      metrics: ["FakeLength"],
    });
    expect(all.base.stats.FakeLength).toBe(XML.length);
    expect(all.results.map((r) => [r.nodeId, r.pathCost])).toEqual([
      ["101", 1],
      ["102", 3],
    ]);
    expect(all.results[0]?.deltas.FakeLength).toBeGreaterThan(0);
    const some = await pool.request("calc.nodePower", {
      handle,
      profile: "as-saved",
      metrics: ["FakeLength"],
      candidates: [PassiveNodeId.parse("102")],
    });
    expect(some.results).toHaveLength(1);
    expect(pool.status().builds).toBe(1);
    await expectKind(
      pool.request("calc.nodePower", {
        handle,
        profile: "as-saved",
        metrics: ["FakeLength"],
        candidates: [PassiveNodeId.parse("999")],
      }),
      "invalid_params",
    );
  });

  it("offers a fresh build of a class as the starting point", async () => {
    const { pool } = await fakePool();
    const base = await pool.baseBuild(CharacterClassId.parse("FixtureClass"));
    expect(base.format).toBe("xml");
    const { handle } = await pool.request("build.load", base);
    expect((await pool.request("build.export", { handle, format: "xml" })).payload).toBe(
      base.payload,
    );
  });

  it("refuses a base build on a closed pool", async () => {
    const { pool } = await fakePool();
    await pool.close();
    await expectKind(pool.baseBuild(CharacterClassId.parse("FixtureClass")), "worker_crashed");
  });

  it("forgets released builds", async () => {
    const { pool } = await fakePool();
    const { handle } = await pool.request("build.load", { format: "xml", payload: XML });
    await pool.request("build.release", { handle });
    await expectKind(pool.request("calc.stats", { handle, profile: "as-saved" }), "unknown_handle");
    await expectKind(pool.request("build.release", { handle }), "unknown_handle");
    // the worker-side release happens before the next job on that worker
    await pool.request("build.load", { format: "xml", payload: XML });
    expect(pool.status().builds).toBe(1);
  });

  it("queues requests and spreads them over all workers", async () => {
    const { pool } = await fakePool({}, { size: 2 });
    const { handle } = await pool.request("build.load", { format: "xml", payload: XML });
    const results = await Promise.all(
      Array.from({ length: 12 }, () => pool.request("calc.stats", { handle, profile: "as-saved" })),
    );
    const pids = new Set(results.map((r) => r.stats.FakePid));
    expect(pids.size).toBe(2);
    expect(new Set(results.map((r) => r.inputHash)).size).toBe(1);
    expect(pool.status()).toMatchObject({ busy: 0, queued: 0 });
  });

  it("restarts a crashed worker and reloads builds into it", async () => {
    const { pool, events } = await fakePool();
    const { handle } = await pool.request("build.load", { format: "xml", payload: XML });
    const before = pool.workerPids()[0];
    await expectKind(
      pool.request("calc.stats", { handle, profile: "as-saved", mainSkill: "crash" }),
      "worker_crashed",
    );
    const res = await pool.request("calc.stats", { handle, profile: "as-saved" });
    expect(res.stats.FakePid).not.toBe(before);
    expect(events.some((e) => e.type === "worker-exited")).toBe(true);
  });

  it("kills a worker that exceeds the request timeout", async () => {
    const { pool } = await fakePool({ requestTimeoutMs: 300 });
    const { handle } = await pool.request("build.load", { format: "xml", payload: XML });
    await expectKind(
      pool.request("calc.stats", { handle, profile: "as-saved", mainSkill: "hang" }),
      "timeout",
    );
    const res = await pool.request("calc.stats", { handle, profile: "as-saved" });
    expect(res.stats.FakeLength).toBe(XML.length);
  });

  it("treats protocol violations as a crashed worker", async () => {
    const { pool } = await fakePool();
    const { handle } = await pool.request("build.load", { format: "xml", payload: XML });
    for (const mainSkill of ["garbage", "wrong-id"]) {
      await expectKind(
        pool.request("calc.stats", { handle, profile: "as-saved", mainSkill }),
        "worker_crashed",
      );
    }
    await expectKind(
      pool.request("calc.stats", { handle, profile: "as-saved", mainSkill: "bad-result" }),
      "calc_failed",
    );
    await pool.request("calc.stats", { handle, profile: "as-saved" });
  });

  it("recycles workers after the configured number of requests", async () => {
    const { pool, events } = await fakePool({ recycleAfterRequests: 3 });
    const { handle } = await pool.request("build.load", { format: "xml", payload: XML });
    const pids = new Set<number | undefined>();
    for (let i = 0; i < 7; i++) {
      pids.add((await pool.request("calc.stats", { handle, profile: "as-saved" })).stats.FakePid);
    }
    expect(events.filter((e) => e.type === "worker-recycled").length).toBeGreaterThanOrEqual(2);
    expect(pids.size).toBeGreaterThanOrEqual(2);
  });

  it("fails start when the worker cannot start or speaks another protocol", async () => {
    await expectKind(fakePool({}, { workerEnv: { FAKE_MODE: "fail-start" } }), "worker_crashed");
    await expectKind(fakePool({}, { workerEnv: { FAKE_MODE: "protocol-2" } }), "protocol_mismatch");
  });

  it("fails start when the install is missing", async () => {
    await expectKind(
      fakePool({}, { install: { srcDir: fixture("nowhere"), luajit: process.execPath } }),
      "worker_crashed",
    );
  });

  it("rejects requests after close", async () => {
    const { pool } = await fakePool();
    await pool.close();
    await expectKind(pool.request("meta.version", {}), "worker_crashed");
  });
});
