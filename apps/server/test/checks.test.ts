import { describe, expect, it } from "vitest";
import { CharacterClassId } from "@astrolabe/contracts/common";
import { CalcFake } from "../src/calc/calc-fake.js";
import { richTextFindings, toPointer } from "../src/engine/checks.js";
import { RELEASE } from "./fixtures.js";

describe("number checks", () => {
  it("accepts calc references to existing stats and text without digits", async () => {
    const calc = new CalcFake({ dataReleaseId: RELEASE });
    const outcomes = await calc.calculate({
      state: {
        classId: CharacterClassId.parse("FixClassA"),
        level: 1,
        tree: { allocated: [], ascendancy: [] },
        skills: [],
        items: [],
        config: {},
      },
      profiles: ["default"],
    });
    const ok = outcomes["default"];
    if (ok?.status !== "ok") throw new Error("fake calc failed");
    const findings = await richTextFindings(calc, [
      {
        path: "/reason",
        text: [
          { type: "text", text: "hits harder by" },
          { type: "calc", ref: { calcId: ok.calcId, stat: "fake.alpha" } },
        ],
      },
    ]);
    expect(findings).toEqual([]);
    const wrongStat = await richTextFindings(calc, [
      { path: "/r", text: [{ type: "calc", ref: { calcId: ok.calcId, stat: "nope" } }] },
    ]);
    expect(wrongStat[0]?.code).toBe("unknown_calc_ref");
  });

  it("only accepts references calculated with the run's calc overrides", async () => {
    const calc = new CalcFake({ dataReleaseId: RELEASE });
    const state = {
      classId: CharacterClassId.parse("FixClassA"),
      level: 1,
      tree: { allocated: [], ascendancy: [] },
      skills: [],
      items: [],
      config: {},
    };
    const calculate = async (overrides?: Record<string, string>) => {
      const out = (
        await calc.calculate({ state, profiles: ["default"], ...(overrides && { overrides }) })
      )["default"];
      if (out?.status !== "ok") throw new Error("fake calc failed");
      return [
        {
          path: "/t",
          text: [{ type: "calc" as const, ref: { calcId: out.calcId, stat: "fake.alpha" } }],
        },
      ];
    };
    const scope = (overrides: Record<string, string>) => ({
      dataReleaseId: RELEASE,
      calcProfiles: ["default"],
      overrides,
    });
    const uber = { enemyIsBoss: "Uber" };
    expect(await richTextFindings(calc, await calculate(uber), scope(uber))).toEqual([]);
    expect(await richTextFindings(calc, await calculate(), scope({}))).toEqual([]);
    // calculated without the player's overrides, or with other ones
    expect((await richTextFindings(calc, await calculate(), scope(uber)))[0]?.code).toBe(
      "unknown_calc_ref",
    );
    expect((await richTextFindings(calc, await calculate(uber), scope({})))[0]?.code).toBe(
      "unknown_calc_ref",
    );
  });

  it("flags digits of any script", async () => {
    const calc = new CalcFake({ dataReleaseId: RELEASE });
    const findings = await richTextFindings(calc, [
      { path: "/t", text: [{ type: "text", text: "٣ times" }] },
    ]);
    expect(findings[0]?.code).toBe("free_number");
  });

  it("escapes JSON pointer segments", () => {
    expect(toPointer(["a/b", "c~d", 0])).toBe("/a~1b/c~0d/0");
    expect(toPointer([])).toBe("/");
  });
});

describe("persisted calc results", () => {
  it("survive a new engine instance on the same store, scoped to release and profile", async () => {
    const { RunStore } = await import("../src/store/run-store.js");
    const { PersistedCalc } = await import("../src/calc/persisted-calc.js");
    const store = new RunStore(":memory:");
    const state = {
      classId: CharacterClassId.parse("FixClassA"),
      level: 1,
      tree: { allocated: [], ascendancy: [] },
      skills: [],
      items: [],
      config: {},
    };
    const first = new PersistedCalc(new CalcFake({ dataReleaseId: RELEASE }), store);
    const outcome = (await first.calculate({ state, profiles: ["default"] }))["default"];
    if (outcome?.status !== "ok") throw new Error("fake calc failed");
    const afterRestart = new PersistedCalc(new CalcFake({ dataReleaseId: RELEASE }), store);
    const text = [{ type: "calc" as const, ref: { calcId: outcome.calcId, stat: "fake.alpha" } }];
    const scope = { dataReleaseId: RELEASE, calcProfiles: ["default"], overrides: {} };
    expect(await richTextFindings(afterRestart, [{ path: "/t", text }], scope)).toEqual([]);
    const otherProfile = { dataReleaseId: RELEASE, calcProfiles: ["other"], overrides: {} };
    expect(
      (await richTextFindings(afterRestart, [{ path: "/t", text }], otherProfile))[0]?.code,
    ).toBe("unknown_calc_ref");
  });
});
