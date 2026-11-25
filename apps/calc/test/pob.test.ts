import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkGoldenBuilds } from "../src/golden.ts";
import type { CalcPool } from "../src/index.ts";
import { CalcServiceError, encodeBuildCode } from "../src/index.ts";
import { golden, havePob, repoRoot, startPobPool } from "./pob-setup.ts";

describe.skipIf(!havePob)("calc pool with headless Path of Building", () => {
  let pool: CalcPool;

  beforeAll(async () => {
    pool = await startPobPool(2);
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
    // export returns exactly the state that was hashed
    expect(exported.payload).toBe(xml);
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

  it("applies overrides after the profile and leaves no trace", async () => {
    const xml = await golden("pobb-ljOBlCON5WGB");
    const { handle } = await pool.request("build.load", { format: "xml", payload: xml });
    const saved = await pool.request("calc.stats", { handle, profile: "as-saved" });
    const profileOnly = await pool.request("calc.stats", { handle, profile: "test-override" });
    const overridden = await pool.request("calc.stats", {
      handle,
      profile: "test-override",
      overrides: { enemyIsBoss: "Uber" },
    });
    const sameAgain = await pool.request("calc.stats", {
      handle,
      profile: "test-override",
      overrides: { enemyIsBoss: "Uber" },
    });
    expect(overridden.overrides).toEqual({ enemyIsBoss: "Uber" });
    expect(profileOnly.overrides).toBeUndefined();
    expect(overridden.calcId).not.toBe(profileOnly.calcId);
    expect(overridden.stats.CombinedDPS).not.toBe(profileOnly.stats.CombinedDPS);
    expect(sameAgain.calcId).toBe(overridden.calcId);
    expect(sameAgain.stats).toEqual(overridden.stats);
    const back = await pool.request("calc.stats", { handle, profile: "as-saved" });
    expect(back.calcId).toBe(saved.calcId);
    expect(back.stats).toEqual(saved.stats);
    await expect(
      pool.request("calc.stats", {
        handle,
        profile: "as-saved",
        overrides: { enemyIsBoss: "exileforge-no-such-value" },
      }),
    ).rejects.toMatchObject({ kind: "invalid_params" });
    // free text would let mod lines into a calculation without a catalog id
    await expect(
      pool.request("calc.stats", {
        handle,
        profile: "as-saved",
        overrides: { customMods: "+1000 to maximum Life" },
      }),
    ).rejects.toMatchObject({ kind: "invalid_params" });
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
    // naming the saved main skill explicitly is the same calculation
    expect(picked.calcId).toBe(res.calcId);
    expect(picked.mainSkill).toBe(res.mainSkill);
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
