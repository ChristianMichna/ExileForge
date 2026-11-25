import { PatchOp, BuildState } from "@astrolabe/contracts";
import { describe, expect, it } from "vitest";
import { diffBuildState, PatchPlanError } from "../src/index.ts";

// Structural fixture ids only; no game content.
const base = BuildState.parse({
  classId: "fixture-class",
  ascendancyId: "fixture-ascendancy",
  level: 50,
  tree: {
    allocated: [{ nodeId: "1" }, { nodeId: "2" }, { nodeId: "3", weaponSet: 1 }],
    ascendancy: ["9"],
  },
  skills: [
    {
      key: "main",
      role: "main",
      gem: { gemId: "gem-a", level: 5 },
      supports: [{ gemId: "gem-s", level: 3 }],
    },
  ],
  items: [
    { slot: "FixtureSlot", item: { kind: "unique", uniqueId: "unique-a" } },
    { slot: "OtherSlot", item: { kind: "unique", uniqueId: "unique-b" } },
  ],
  config: { optionA: true },
});

const edit = (patch: Record<string, unknown>): BuildState =>
  BuildState.parse({ ...base, ...patch });

describe("diffBuildState", () => {
  it("gives no ops for equal states", () => {
    expect(diffBuildState(base, structuredClone(base))).toEqual([]);
  });

  it("plans level, class and ascendancy changes first", () => {
    const ops = diffBuildState(
      base,
      edit({ classId: "other-class", ascendancyId: "other-ascendancy", level: 60 }),
    );
    expect(ops.slice(0, 3)).toEqual([
      { op: "setClass", classId: "other-class" },
      { op: "setAscendancy", ascendancyId: "other-ascendancy" },
      { op: "setLevel", level: 60 },
    ]);
  });

  it("sets the ascendancy again after a class change, since PoB drops it", () => {
    const ops = diffBuildState(base, edit({ classId: "other-class" }));
    expect(ops).toEqual([
      { op: "setClass", classId: "other-class" },
      { op: "setAscendancy", ascendancyId: "fixture-ascendancy" },
      // PoB drops unconnected passives on a class change: the whole tree again
      { op: "allocateNodes", nodeIds: ["1", "2", "9"] },
      { op: "allocateNodes", nodeIds: ["3"], weaponSet: 1 },
    ]);
    expect(diffBuildState(base, edit({ classId: "other-class", ascendancyId: undefined }))).toEqual(
      [
        { op: "setClass", classId: "other-class" },
        { op: "allocateNodes", nodeIds: ["1", "2", "9"] },
        { op: "allocateNodes", nodeIds: ["3"], weaponSet: 1 },
      ],
    );
  });

  it("allocates only new nodes when nothing is removed", () => {
    const to = edit({
      tree: {
        allocated: [...base.tree.allocated, { nodeId: "4", weaponSet: 2 }],
        ascendancy: ["9"],
      },
    });
    expect(diffBuildState(base, to)).toEqual([
      { op: "allocateNodes", nodeIds: ["4"], weaponSet: 2 },
    ]);
  });

  it("deallocates before allocating the whole target tree, by weapon set", () => {
    const to = edit({
      tree: {
        allocated: [{ nodeId: "1" }, { nodeId: "4", weaponSet: 2 }, { nodeId: "5" }],
        ascendancy: ["9", "10"],
      },
    });
    expect(diffBuildState(base, to)).toEqual([
      { op: "deallocateNodes", nodeIds: ["2", "3"] },
      // deallocating drops dependent nodes in PoB, so every target node is allocated again
      { op: "allocateNodes", nodeIds: ["1", "5", "9", "10"] },
      { op: "allocateNodes", nodeIds: ["4"], weaponSet: 2 },
    ]);
  });

  it("moves a node to another weapon set by removing and allocating it", () => {
    const to = edit({
      tree: {
        allocated: [{ nodeId: "1" }, { nodeId: "2" }, { nodeId: "3", weaponSet: 2 }],
        ascendancy: ["9"],
      },
    });
    expect(diffBuildState(base, to)).toEqual([
      { op: "deallocateNodes", nodeIds: ["3"] },
      { op: "allocateNodes", nodeIds: ["1", "2", "9"] },
      { op: "allocateNodes", nodeIds: ["3"], weaponSet: 2 },
    ]);
  });

  it("adds, replaces and removes skill groups by key", () => {
    const skill = (key: string, level: number) => ({
      key,
      role: "utility",
      gem: { gemId: "gem-b", level },
      supports: [],
    });
    const to = edit({
      skills: [{ ...base.skills[0], gem: { gemId: "gem-a", level: 6 } }, skill("extra", 1)],
    });
    const ops = diffBuildState(base, to);
    expect(ops).toEqual([
      expect.objectContaining({ op: "setSkill", groupKey: "main", level: 6, quality: 0 }),
      expect.objectContaining({ op: "setSkill", groupKey: "extra", gemId: "gem-b" }),
    ]);
    expect(diffBuildState(base, edit({ skills: [] }))).toEqual([
      { op: "removeSkill", groupKey: "main" },
    ]);
  });

  it("renders only changed items and removes unequipped ones", () => {
    const rendered: string[] = [];
    const to = edit({
      items: [{ slot: "FixtureSlot", item: { kind: "unique", uniqueId: "unique-c" } }],
    });
    const ops = diffBuildState(base, to, {
      renderItem: (_item, slot) => {
        rendered.push(slot);
        return `text for ${slot}`;
      },
    });
    expect(ops).toEqual([
      { op: "removeItem", slot: "OtherSlot" },
      { op: "setItem", slot: "FixtureSlot", itemText: "text for FixtureSlot" },
    ]);
    expect(rendered).toEqual(["FixtureSlot"]);
  });

  it("refuses to guess item text without a renderer", () => {
    const to = edit({
      items: [{ slot: "FixtureSlot", item: { kind: "unique", uniqueId: "unique-c" } }],
    });
    expect(() => diffBuildState(base, to)).toThrow(PatchPlanError);
  });

  it("sets changed and new config values", () => {
    expect(diffBuildState(base, edit({ config: { optionA: true, optionB: 3 } }))).toEqual([
      { op: "setConfig", key: "optionB", value: 3 },
    ]);
    expect(diffBuildState(base, edit({ config: { optionA: false } }))).toEqual([
      { op: "setConfig", key: "optionA", value: false },
    ]);
  });

  it("ignores a changed skill role, which no op carries", () => {
    const to = edit({ skills: [{ ...base.skills[0], role: "secondary" }] });
    expect(diffBuildState(base, to)).toEqual([]);
  });

  it("refuses weapon sets on skills and unusable item text", () => {
    const withSet = edit({ skills: [{ ...base.skills[0], weaponSet: 1 }] });
    expect(() => diffBuildState(base, withSet)).toThrow(PatchPlanError);
    const to = edit({
      items: [{ slot: "FixtureSlot", item: { kind: "unique", uniqueId: "unique-c" } }],
    });
    expect(() => diffBuildState(base, to, { renderItem: () => "" })).toThrow(PatchPlanError);
  });

  it("throws for changes no op can express", () => {
    expect(() => diffBuildState(base, edit({ config: {} }))).toThrow(PatchPlanError);
    expect(() => diffBuildState(base, edit({ ascendancyId: undefined }))).toThrow(PatchPlanError);
    const twice = edit({ tree: { allocated: [{ nodeId: "1" }, { nodeId: "1" }], ascendancy: [] } });
    expect(() => diffBuildState(base, twice)).toThrow(PatchPlanError);
  });

  it("only produces ops the contract accepts", () => {
    const to = edit({
      classId: "other-class",
      level: 70,
      tree: { allocated: [{ nodeId: "7", weaponSet: 1 }], ascendancy: [] },
      skills: [],
      items: [],
      config: { optionA: false },
    });
    for (const op of diffBuildState(base, to)) {
      expect(PatchOp.safeParse(op).success, JSON.stringify(op)).toBe(true);
    }
  });
});
