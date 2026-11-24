import { describe, expect, it } from "vitest";
import { CharacterClassId } from "@exileforge/contracts/common";
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
