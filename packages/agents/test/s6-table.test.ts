import { describe, expect, it } from "vitest";
import type { DataRelease } from "@astrolabe/contracts/catalog";
import { releaseStageTable } from "../src/stages/s6-table.js";

const release = (acts: { act: number; areaLevel: number; points: number }[], max = 20) =>
  ({
    id: "poe2-fix+r1",
    maxCharacterLevel: { value: max, origin: "pob-code" },
    passivePoints: {
      mainTree: { perLevel: 1, fromLevel: 2, origin: "pob-code" },
      weaponSetByAct: { acts, origin: "pob-code" },
    },
  }) as unknown as DataRelease;

describe("releaseStageTable", () => {
  it("makes a stage per act and an endgame stage with all points", () => {
    const rows = releaseStageTable(
      release([
        { act: 2, areaLevel: 12, points: 2 },
        { act: 1, areaLevel: 6, points: 1 },
      ]),
    );
    expect(rows).toEqual([
      {
        key: "act-1",
        label: "Act 1",
        kind: "campaign",
        act: 1,
        levelRange: [1, 6],
        passivePoints: 6,
      },
      {
        key: "act-2",
        label: "Act 2",
        kind: "campaign",
        act: 2,
        levelRange: [7, 12],
        passivePoints: 14,
      },
      {
        key: "endgame",
        label: "Endgame",
        kind: "endgame",
        levelRange: [13, 20],
        passivePoints: 22,
      },
    ]);
  });

  it("caps acts above the maximum level and skips empty bands", () => {
    const rows = releaseStageTable(release([{ act: 1, areaLevel: 30, points: 1 }]));
    expect(rows).toEqual([
      {
        key: "act-1",
        label: "Act 1",
        kind: "campaign",
        act: 1,
        levelRange: [1, 20],
        passivePoints: 20,
      },
    ]);
  });

  it("keeps the points of acts past the maximum level in the last stage", () => {
    const rows = releaseStageTable(
      release([
        { act: 1, areaLevel: 30, points: 1 },
        { act: 2, areaLevel: 40, points: 1 },
      ]),
    );
    expect(rows).toEqual([
      {
        key: "act-1",
        label: "Act 1",
        kind: "campaign",
        act: 1,
        levelRange: [1, 20],
        passivePoints: 21,
      },
    ]);
  });

  it("returns an error text instead of a default table without release facts", () => {
    expect(typeof releaseStageTable(undefined)).toBe("string");
    expect(typeof releaseStageTable({ id: "x" } as unknown as DataRelease)).toBe("string");
  });
});
