import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  CalcRef,
  DataReleaseId,
  GemId,
  PobVersion,
  Source,
  measured,
  parseDataReleaseId,
  sourced,
} from "../src/index.js";
import type { Measured, ModId, Sourced } from "../src/index.js";
import { without } from "./helpers.js";

const pobSource = {
  kind: "pob",
  pobVersion: "v9.9.9",
  dataReleaseId: "poe2-9.8.7+r3",
  calcProfile: "fixture-profile",
  calcId: "calc-1",
} as const;

describe("DataReleaseId", () => {
  it("accepts poe2-<version>+r<n>", () => {
    expect(DataReleaseId.safeParse("poe2-9.8.7+r3").success).toBe(true);
    expect(DataReleaseId.safeParse("poe2-9.8.7.6+r12").success).toBe(true);
  });

  it.each(["", "poe2-9.8.7", "poe1-9.8.7+r1", "poe2-x.y+r1", "poe2-9.8.7+r"])(
    "rejects %j",
    (id) => {
      expect(DataReleaseId.safeParse(id).success).toBe(false);
    },
  );

  it("parses into parts and throws on garbage", () => {
    expect(parseDataReleaseId("poe2-9.8.7+r3")).toEqual({ gameVersion: "9.8.7", revision: 3 });
    expect(() => parseDataReleaseId("nope")).toThrow(/Invalid data release id/);
  });
});

describe("PobVersion", () => {
  it("accepts release tags with and without v", () => {
    expect(PobVersion.safeParse("v9.9.9").success).toBe(true);
    expect(PobVersion.safeParse("9.9.9").success).toBe(true);
    expect(PobVersion.safeParse("main").success).toBe(false);
  });
});

describe("catalog ids", () => {
  it("are branded per kind at type level", () => {
    const gem = GemId.parse("Fixture/Gems/One");
    // @ts-expect-error a GemId is not a ModId
    const mod: ModId = gem;
    expect(mod).toBe("Fixture/Gems/One");
  });

  it("reject empty strings", () => {
    expect(GemId.safeParse("").success).toBe(false);
  });
});

describe("Source", () => {
  it("accepts every primary kind and derived", () => {
    const sources = [
      pobSource,
      {
        kind: "gamedata",
        dataReleaseId: "poe2-9.8.7+r3",
        entity: { kind: "mod", id: "FixtureMod1" },
        field: "/stats/0/max",
      },
      {
        kind: "market",
        provider: "fixture-market",
        league: "Fixture League",
        fetchedAt: "2026-01-01T00:00:00Z",
        confidence: "low",
      },
      {
        kind: "derived",
        formula: "fixture.expected-cost",
        formulaVersion: "0.0.1",
        inputs: [pobSource],
        seed: 42,
      },
    ];
    for (const s of sources) expect(Source.parse(s)).toEqual(s);
  });

  it("rejects derived without inputs and nested derived", () => {
    const derived = { kind: "derived", formula: "f", formulaVersion: "1", inputs: [] };
    expect(Source.safeParse(derived).success).toBe(false);
    const nested = { ...derived, inputs: [{ ...derived, inputs: [pobSource] }] };
    expect(Source.safeParse(nested).success).toBe(false);
  });

  it("requires a calc profile on PoB numbers", () => {
    expect(Source.safeParse(without(pobSource, "calcProfile")).success).toBe(false);
  });
});

describe("hand-written generic types match the schema factories", () => {
  it("Sourced<number> and Measured<number>", () => {
    expectTypeOf<z.infer<ReturnType<typeof sourced<z.ZodNumber>>>>().toEqualTypeOf<
      Sourced<number>
    >();
    expectTypeOf<z.infer<ReturnType<typeof measured<z.ZodNumber>>>>().toEqualTypeOf<
      Measured<number>
    >();
  });
});

describe("sourced / measured", () => {
  const SourcedNumber = sourced(z.number());
  const MeasuredNumber = measured(z.number());

  it("sourced needs a source", () => {
    expect(SourcedNumber.safeParse({ value: 1 }).success).toBe(false);
    expect(SourcedNumber.safeParse({ value: 1, source: pobSource }).success).toBe(true);
  });

  it("measured makes missing data explicit instead of 0", () => {
    expect(MeasuredNumber.parse({ status: "uncalibrated", reason: "no price data" })).toEqual({
      status: "uncalibrated",
      reason: "no price data",
    });
    expect(
      MeasuredNumber.safeParse({
        status: "failed",
        error: { code: "market_unavailable", message: "fetch failed" },
      }).success,
    ).toBe(true);
    expect(MeasuredNumber.safeParse({ status: "ok", value: 0 }).success).toBe(false);
  });

  it("CalcRef points to a stat of a calculation", () => {
    expect(CalcRef.safeParse({ calcId: "calc-1", stat: "fixture_stat" }).success).toBe(true);
    expect(CalcRef.safeParse({ calcId: "calc-1" }).success).toBe(false);
  });
});
