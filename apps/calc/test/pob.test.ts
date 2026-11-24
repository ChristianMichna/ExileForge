import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkGoldenBuilds } from "../src/golden.ts";
import {
  CalcPool,
  CalcServiceError,
  encodeBuildCode,
  loadCalcProfiles,
  loadPoolConfig,
  pobInstallFromHome,
} from "../src/index.ts";

/*
 * Integration tests against the real, pinned Path of Building. They need
 * tools/setup_pob.sh (or the Windows setup in CI). Without PoB they are
 * skipped, unless EXILEFORGE_REQUIRE_POB=1 (CI), where a missing PoB fails.
 */

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const install = pobInstallFromHome(process.env.EXILEFORGE_POB_HOME ?? join(repoRoot, ".pob"));
const havePob =
  existsSync(install.luajit) && existsSync(join(install.srcDir, "HeadlessWrapper.lua"));
const required = process.env.EXILEFORGE_REQUIRE_POB === "1";

if (required && !havePob) {
  throw new Error(
    `EXILEFORGE_REQUIRE_POB=1 but no PoB install at ${install.srcDir} / ${install.luajit}`,
  );
}

const golden = (id: string): Promise<string> =>
  readFile(join(repoRoot, "evals", "golden", "builds", `${id}.xml`), "utf8");

describe.skipIf(!havePob)("calc pool with headless Path of Building", () => {
  let pool: CalcPool;

  beforeAll(async () => {
    const config = await loadPoolConfig(join(repoRoot, "config", "calc", "pool.json"));
    pool = await CalcPool.start({
      install,
      profiles: await loadCalcProfiles(
        fileURLToPath(new URL("./fixtures/calc-profiles", import.meta.url)),
      ),
      size: 2,
      config,
    });
  });

  afterAll(async () => {
    await pool.close();
  });

  it("reports the pinned PoB and its game version", () => {
    expect(pool.meta.pobVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pool.meta.gameVersion).toMatch(/^\d+(\.\d+)+$/);
    expect(pool.meta.dataReleaseId).toBe(`poe2-${pool.meta.gameVersion}+r0`);
  });

  it("matches every recorded golden build", async () => {
    const outcomes = await checkGoldenBuilds(pool, repoRoot);
    expect(outcomes.length).toBeGreaterThan(0);
    for (const o of outcomes) {
      expect(o, `${o.id}: ${o.detail ?? ""} ${JSON.stringify(o.diffs)}`).toMatchObject({
        status: "ok",
      });
    }
  });

  it("gives the same numbers for XML, build code and re-exported XML", async () => {
    const xml = await golden("pr2-synthetic-fixture");
    const a = await pool.request("build.load", { format: "xml", payload: xml });
    const b = await pool.request("build.load", { format: "code", payload: encodeBuildCode(xml) });
    const ra = await pool.request("calc.stats", { handle: a.handle, profile: "as-saved" });
    const rb = await pool.request("calc.stats", { handle: b.handle, profile: "as-saved" });
    expect(rb.stats).toEqual(ra.stats);
    expect(rb.calcId).toBe(ra.calcId);

    const exported = await pool.request("build.export", { handle: a.handle, format: "xml" });
    expect(exported.payload).toMatch(/^<\?xml|^<PathOfBuilding2/);
    const c = await pool.request("build.load", { format: "xml", payload: exported.payload });
    const rc = await pool.request("calc.stats", { handle: c.handle, profile: "as-saved" });
    expect(rc.stats.CombinedDPS).toBe(ra.stats.CombinedDPS);
    expect(rc.stats.Life).toBe(ra.stats.Life);
    for (const h of [a.handle, b.handle, c.handle])
      await pool.request("build.release", { handle: h });
  });

  it("applies a profile without changing the stored build", async () => {
    const xml = await golden("pobb-ljOBlCON5WGB");
    const { handle } = await pool.request("build.load", { format: "xml", payload: xml });
    const saved = await pool.request("calc.stats", { handle, profile: "as-saved" });
    const override = await pool.request("calc.stats", { handle, profile: "test-override" });
    const again = await pool.request("calc.stats", { handle, profile: "as-saved" });
    expect(override.stats.CombinedDPS).not.toBe(saved.stats.CombinedDPS);
    expect(override.calcId).not.toBe(saved.calcId);
    expect(again.stats).toEqual(saved.stats);
    expect(again.calcId).toBe(saved.calcId);
    await pool.request("build.release", { handle });
  });

  it("reports the main skill and unsupported lines from PoB", async () => {
    const xml = await golden("pobb-ljOBlCON5WGB");
    const { handle } = await pool.request("build.load", { format: "xml", payload: xml });
    const res = await pool.request("calc.stats", { handle, profile: "as-saved" });
    expect(res.mainSkill).toBeTruthy();
    expect(res.unsupportedMods.length).toBeGreaterThan(0);
    const picked = await pool.request("calc.stats", {
      handle,
      profile: "as-saved",
      mainSkill: res.mainSkill ?? "",
    });
    expect(picked.stats.CombinedDPS).toBe(res.stats.CombinedDPS);
    await expect(
      pool.request("calc.stats", { handle, profile: "as-saved", mainSkill: "No Such Skill Group" }),
    ).rejects.toMatchObject({ kind: "invalid_params" });
    await pool.request("build.release", { handle });
  });

  it("rejects bad builds and bad profiles with clear kinds", async () => {
    await expect(
      pool.request("build.load", {
        format: "xml",
        payload: "<PathOfBuilding><Build/></PathOfBuilding>",
      }),
    ).rejects.toMatchObject({ kind: "build_load_failed" });
    await expect(
      pool.request("build.load", { format: "xml", payload: "garbage" }),
    ).rejects.toMatchObject({
      kind: "build_load_failed",
    });
    const xml = await golden("pr2-synthetic-fixture");
    const { handle } = await pool.request("build.load", { format: "xml", payload: xml });
    await expect(
      pool.request("calc.stats", { handle, profile: "test-bad-key" }),
    ).rejects.toMatchObject({
      kind: "invalid_params",
    });
    // the failed profile left no trace
    await pool.request("calc.stats", { handle, profile: "as-saved" });
    await pool.request("build.release", { handle });
  });

  it("survives a killed worker", async () => {
    const xml = await golden("pr2-synthetic-fixture");
    const { handle } = await pool.request("build.load", { format: "xml", payload: xml });
    const before = await pool.request("calc.stats", { handle, profile: "as-saved" });
    for (const pid of pool.workerPids()) if (pid) process.kill(pid);
    let after;
    for (let i = 0; i < 3 && !after; i++) {
      after = await pool
        .request("calc.stats", { handle, profile: "as-saved" })
        .catch((e: unknown) => {
          if (e instanceof CalcServiceError && e.kind === "worker_crashed") return undefined;
          throw e;
        });
    }
    expect(after?.stats).toEqual(before.stats);
    await pool.request("build.release", { handle });
  });
});
