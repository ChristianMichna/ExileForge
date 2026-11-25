import { describe, expect, it } from "vitest";
import type { DataRelease } from "@astrolabe/contracts/catalog";
import { targetSize } from "../src/stages/s5-target.js";

const release = (over: object = {}) =>
  ({
    id: "poe2-fix+r1",
    maxCharacterLevel: { value: 20, origin: "pob-code" },
    passivePoints: {
      mainTree: { perLevel: 1, fromLevel: 2, origin: "pob-code" },
      weaponSetByAct: {
        acts: [
          { act: 1, areaLevel: 5, points: 1 },
          { act: 2, areaLevel: 10, points: 1 },
        ],
        origin: "pob-code",
      },
    },
    ...over,
  }) as unknown as DataRelease;

describe("targetSize", () => {
  it("adds the level points from fromLevel to the maximum and every weapon set point", () => {
    expect(targetSize(release())).toEqual({ level: 20, passivePoints: 19 + 2 });
  });

  it("names what is missing instead of guessing", () => {
    expect(targetSize(undefined)).toMatch(/release record/);
    expect(targetSize(release({ maxCharacterLevel: undefined }))).toMatch(/maxCharacterLevel/);
    expect(targetSize(release({ passivePoints: undefined }))).toMatch(/passivePoints/);
  });

  it("rejects inconsistent facts", () => {
    expect(
      targetSize(
        release({
          passivePoints: {
            mainTree: { perLevel: 1, fromLevel: 30, origin: "pob-code" },
            weaponSetByAct: { acts: [{ act: 1, areaLevel: 5, points: 1 }], origin: "pob-code" },
          },
        }),
      ),
    ).toMatch(/inconsistent/);
  });
});
