import { describe, expect, it } from "vitest";
import {
  calcIdsOf,
  completenessOf,
  guidePobVersion,
  pobVersionsOf,
} from "../src/stages/s11-publish.js";
import type { GuideDraft } from "../src/stages/s10-validate.js";

const weights = {
  summary: 1,
  mechanics: 1,
  progression: 1,
  gear: 1,
  crafting: 1,
  playstyle: 1,
  atlas: 1,
  variants: 1,
  faq: 1,
};

const draft = (parts: Record<string, unknown>) => parts as never as GuideDraft;

describe("S11 publishing", () => {
  it("collects the PoB versions named anywhere in the draft", () => {
    const found = pobVersionsOf({ a: [{ pobVersion: "v1" }, { x: { pobVersion: "v1" } }], b: 1 });
    expect([...found]).toEqual(["v1"]);
    expect(pobVersionsOf({ a: { pobVersion: "v1" }, b: { pobVersion: "v2" } }).size).toBe(2);
    expect(pobVersionsOf({}).size).toBe(0);
  });

  it("collects the calc ids referred to anywhere in the draft", () => {
    const found = calcIdsOf({
      a: [{ calcs: { x: { calcId: "c1" } } }, { calcId: "c1" }],
      b: { calcId: "c2" },
    });
    expect([...found].sort()).toEqual(["c1", "c2"]);
    expect(calcIdsOf({}).size).toBe(0);
  });

  it("scores the weighted share of non-empty parts", () => {
    const full = draft({
      progression: { stages: [1] },
      gear: { tiers: [1] },
      crafting: [1],
      variants: [1],
      faq: [1],
    });
    expect(completenessOf(full, weights)).toBe(100);
    const sparse = draft({
      progression: { stages: [1] },
      gear: { tiers: [1] },
      crafting: [],
      variants: [],
      faq: [],
    });
    expect(completenessOf(sparse, weights)).toBeCloseTo((100 * 6) / 9);
    expect(completenessOf(sparse, { ...weights, crafting: 0, variants: 0, faq: 0 })).toBe(100);
  });

  describe("guidePobVersion", () => {
    const versions: Record<string, string> = { "calc-1": "v1", "calc-2": "v1", "calc-3": "v2" };
    const calc = {
      getResult: (id: string) =>
        id === "calc-boom"
          ? Promise.reject(new Error("io"))
          : Promise.resolve(versions[id] === undefined ? undefined : { pobVersion: versions[id] }),
    };
    const run = (d: unknown) => guidePobVersion(calc as never, d);

    it("takes the version of the calculations when no value is sourced", async () => {
      await expect(run({ a: { calcId: "calc-1" }, b: [{ calcId: "calc-2" }] })).resolves.toBe("v1");
    });

    it("accepts a sourced value of the same version", async () => {
      await expect(run({ a: { pobVersion: "v1" }, b: { calcId: "calc-1" } })).resolves.toBe("v1");
    });

    it("fails for differing versions and names them", async () => {
      await expect(run({ a: { calcId: "calc-1" }, b: { calcId: "calc-3" } })).rejects.toThrow(
        /found 2.*v1.*v2/,
      );
      await expect(run({ a: { pobVersion: "v2" }, b: { calcId: "calc-1" } })).rejects.toThrow(
        /found 2/,
      );
    });

    it("fails without any version, for a gone result and for a failing read", async () => {
      await expect(run({})).rejects.toThrow(/found 0/);
      await expect(run({ a: { calcId: "calc-9" } })).rejects.toThrow(/is gone/);
      await expect(run({ a: { calcId: "calc-boom" } })).rejects.toMatchObject({
        message: expect.stringContaining("failed") as unknown,
        cause: expect.any(Error) as unknown,
      });
    });
  });
});
