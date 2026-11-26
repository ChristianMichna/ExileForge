import { describe, expect, it } from "vitest";
import { BuildState } from "@astrolabe/contracts/build";
import { scaleGemLevels } from "../src/calc/gem-levels.js";
import type { CatalogPort } from "../src/ports/catalog.js";

const gem = (levels: [number, number][]) => ({
  id: "G",
  name: "G",
  kind: "skill",
  tags: [],
  qualityStats: [],
  levels: levels.map(([level, req]) => ({
    level,
    requirements: { level: req, attributes: {} },
    stats: {},
  })),
});
const catalog = (known: Record<string, unknown>) =>
  ({
    get: (ref: { id: string }) =>
      known[ref.id] === undefined ? undefined : { kind: "gem", id: ref.id, entity: known[ref.id] },
  }) as never as CatalogPort;
const state = BuildState.parse({
  classId: "C",
  level: 12,
  tree: { allocated: [] },
  skills: [
    {
      key: "main",
      role: "main",
      gem: { gemId: "G", level: 5 },
      supports: [{ gemId: "S", level: 5 }],
    },
  ],
  items: [],
  config: {},
});

describe("scaleGemLevels", () => {
  const known = {
    G: gem([
      [1, 0],
      [2, 10],
      [3, 20],
      [4, 30],
      [5, 40],
    ]),
    S: gem([
      [1, 0],
      [2, 50],
    ]),
  };

  it("sets every gem to the highest level the character level allows", () => {
    const out = scaleGemLevels(state, 12, catalog(known));
    expect(out.skills[0]?.gem.level).toBe(2);
    expect(out.skills[0]?.supports[0]?.level).toBe(1);
  });

  it("never exceeds the level the build aims for", () => {
    expect(scaleGemLevels(state, 100, catalog(known)).skills[0]?.gem.level).toBe(5);
  });

  it("keeps the lowest level of a gem that cannot be used yet, so a gate can name it", () => {
    const late = {
      ...known,
      G: gem([
        [1, 30],
        [2, 40],
      ]),
    };
    expect(scaleGemLevels(state, 5, catalog(late)).skills[0]?.gem.level).toBe(1);
  });

  it("fails for a gem the catalog does not know", () => {
    expect(() => scaleGemLevels(state, 12, catalog({ G: known.G }))).toThrow(/Gem S/);
  });
});
