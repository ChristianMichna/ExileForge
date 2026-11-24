import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compareStats, sameValue } from "../src/golden.ts";
import {
  autoPoolSize,
  CalcServiceError,
  decodeBuildCode,
  encodeBuildCode,
  loadCalcProfiles,
  loadPoolConfig,
} from "../src/index.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("build codes", () => {
  it("round-trips XML with non-ASCII text", () => {
    const xml = "<PathOfBuilding2><Build/><Notes>Jörg Ü – 測試</Notes></PathOfBuilding2>";
    const code = encodeBuildCode(xml);
    expect(code).toMatch(/^[A-Za-z0-9_-]+=*$/);
    expect(decodeBuildCode(code)).toBe(xml);
    expect(decodeBuildCode(`  ${code.slice(0, 10)}\n${code.slice(10)} `)).toBe(xml);
  });

  it("rejects text that is not a build code", () => {
    for (const bad of ["", "not a code!", "AAAA"]) {
      expect(() => decodeBuildCode(bad)).toThrow(CalcServiceError);
    }
  });
});

describe("calc profiles", () => {
  it("loads the repository profiles", async () => {
    const profiles = await loadCalcProfiles(join(repoRoot, "config", "calc-profiles"));
    const asSaved = profiles.get("as-saved");
    expect(asSaved?.config).toEqual([]);
    expect(asSaved?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a profile whose id differs from its file name, or that sets an option twice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "exileforge-profiles-"));
    try {
      await writeFile(
        join(dir, "a.json"),
        JSON.stringify({ id: "b", description: "x", config: [] }),
      );
      await expect(loadCalcProfiles(dir)).rejects.toThrow(/does not match/);
      await writeFile(
        join(dir, "a.json"),
        JSON.stringify({
          id: "a",
          description: "x",
          config: [
            { key: "k", value: 1 },
            { key: "k", value: 2 },
          ],
        }),
      );
      await expect(loadCalcProfiles(dir)).rejects.toThrow(/set twice/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("pool config", () => {
  it("parses config/calc/pool.json", async () => {
    const cfg = await loadPoolConfig(join(repoRoot, "config", "calc", "pool.json"));
    expect(cfg.maxWorkers).toBeGreaterThanOrEqual(1);
  });

  it("sizes the pool by cores and free memory", () => {
    const cfg = { maxWorkers: 4, workerMemoryMb: 500 };
    const gb = 1024 ** 3;
    expect(autoPoolSize(cfg, 16, 32 * gb)).toBe(4);
    expect(autoPoolSize(cfg, 3, 32 * gb)).toBe(2);
    expect(autoPoolSize(cfg, 16, 2 * gb)).toBe(2);
    expect(autoPoolSize(cfg, 1, 0.1 * gb)).toBe(1);
  });
});

describe("golden comparison", () => {
  const tol = { relative: 0.0001, absolute: 0.01 };
  it("never treats a missing value as zero", () => {
    expect(sameValue(null, 0, tol)).toBe(false);
    expect(sameValue(null, null, tol)).toBe(true);
    expect(sameValue(100, 100.005, tol)).toBe(true);
    expect(sameValue(100, 101, tol)).toBe(false);
  });

  it("lists only differing stats", () => {
    expect(compareStats({ A: 1, B: 2 }, { A: 1, B: 3, C: null }, ["A", "B", "C"], tol)).toEqual([
      { stat: "B", expected: 3, actual: 2 },
    ]);
  });
});
