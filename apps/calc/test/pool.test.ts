import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { CalcMethodName, CalcParams } from "@exileforge/contracts";
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
        "calc.nodePower",
        untyped<"calc.nodePower">({ handle, profile: "as-saved", metrics: ["X"] }),
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
