import { describe, expect, it } from "vitest";
import { completenessOf, pobVersionsOf } from "../src/stages/s11-publish.js";
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
});
