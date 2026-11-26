import type { CatalogDiff } from "@astrolabe/contracts";
import { describe, expect, it } from "vitest";
import { RevalidationError, collectGuideRefs, revalidateGuide } from "../src/index.js";

const R1 = "poe2-9.8.7+r1";
const R2 = "poe2-9.8.7+r2";
const R3 = "poe2-9.8.8+r1";
const guide = {
  metadata: { guideId: "0b0f6d6e-3a3a-4c1e-9a53-6c1f2f6f9a11", revision: 1, dataReleaseId: R1 },
  summary: { classId: "class-a", ascendancyId: "asc-a", mainSkillId: "gem-main" },
  progression: {
    stages: [
      {
        key: "act1",
        allocationOrder: ["node-1", "node-2"],
        state: { skills: [{ gem: { gemId: "gem-main" }, supports: [{ gemId: "gem-sup" }] }] },
        rationale: [{ subject: { kind: "passiveNode", id: "node-1" }, reason: [] }],
      },
      { key: "endgame", allocationOrder: ["node-3"], state: {} },
    ],
  },
  gear: { tiers: [{ slots: [{ target: { baseItemId: "base-a", mods: [{ modId: "mod-a" }] } }] }] },
  faq: [{ answer: [{ type: "entity", ref: { kind: "uniqueItem", id: "uniq-a" } }] }],
};
const diff = (from: string, to: string, kinds: CatalogDiff["kinds"]): CatalogDiff =>
  ({ schemaVersion: 1, from, to, kinds }) as CatalogDiff;
const facts = { pobVersion: "v1" } as never;
const run = (diffs: CatalogDiff[], to: object = facts) =>
  revalidateGuide({
    guide,
    diffs,
    facts: { from: facts, to: to as never },
    checkedAt: "2026-11-26T05:00:00Z",
  });

describe("collectGuideRefs", () => {
  it("finds ids by field name, entity segments and the stage of each place", () => {
    const refs = collectGuideRefs(guide);
    const has = (kind: string, id: string) => refs.filter((r) => r.kind === kind && r.id === id);
    expect(has("characterClass", "class-a")).toHaveLength(1);
    expect(has("gem", "gem-main")).toHaveLength(2);
    expect(has("passiveNode", "node-1").map((r) => r.location)).toEqual([
      "/progression/stages/0/allocationOrder/0",
      "/progression/stages/0/rationale/0/subject",
    ]);
    expect(has("passiveNode", "node-3")[0]?.stageKey).toBe("endgame");
    expect(has("mod", "mod-a")[0]?.stageKey).toBeUndefined();
    expect(has("uniqueItem", "uniq-a")).toHaveLength(1);
    expect(has("baseItem", "base-a")).toHaveLength(1);
  });
});

describe("revalidateGuide", () => {
  it("is unaffected when the diff does not touch the guide", () => {
    const res = run([diff(R1, R2, { mod: { added: ["mod-z"], removed: ["mod-y"], changed: [] } })]);
    expect(res.verdict).toBe("unaffected");
    expect(res.findings).toEqual([]);
    expect(res.checkedReferences).toBeGreaterThan(5);
  });
  it("reports a removed id as broken and a changed one with its fields and stages", () => {
    const res = run([
      diff(R1, R2, {
        gem: { added: [], removed: ["gem-sup"], changed: [] },
        passiveNode: {
          added: [],
          removed: [],
          changed: [{ id: "node-1", fields: [{ path: "/name", before: "A", after: "B" }] }],
        },
      }),
    ]);
    expect(res.verdict).toBe("broken");
    const removed = res.findings.find((f) => f.impact === "removed");
    expect(removed?.ref).toEqual({ kind: "gem", id: "gem-sup" });
    const changed = res.findings.find((f) => f.impact === "changed");
    expect(changed?.stageIds).toEqual(["act1"]);
    expect(changed?.fields).toEqual([{ path: "/name", before: "A", after: "B" }]);
  });
  it("composes diffs over a chain: first before, last after, and drops changes that cancel out", () => {
    const step = (from: string, to: string, b: number, a: number, id = "mod-a") =>
      diff(from, to, {
        mod: {
          added: [],
          removed: [],
          changed: [{ id, fields: [{ path: "/x", before: b, after: a }] }],
        },
      });
    const res = run([step(R1, R2, 1, 2), step(R2, R3, 2, 3)]);
    expect(res.chain).toEqual([R1, R2, R3]);
    expect(res.findings[0]?.fields).toEqual([{ path: "/x", before: 1, after: 3 }]);
    expect(run([step(R1, R2, 1, 2), step(R2, R3, 2, 1)]).verdict).toBe("unaffected");
  });
  it("counts an entity that was removed and came back as changed as a whole", () => {
    const res = run([
      diff(R1, R2, { mod: { added: [], removed: ["mod-a"], changed: [] } }),
      diff(R2, R3, { mod: { added: ["mod-a"], removed: [], changed: [] } }),
    ]);
    expect(res.verdict).toBe("needs-recalc");
    expect(res.findings[0]?.fields).toEqual([{ path: "/" }]);
  });
  it("needs recalculation when only a release fact changed", () => {
    const res = run([diff(R1, R2, {})], { pobVersion: "v2" });
    expect(res.verdict).toBe("needs-recalc");
    expect(res.factChanges).toEqual(["pobVersion"]);
  });
  it("fails loudly when the diffs do not fit the guide", () => {
    expect(() => run([])).toThrow(RevalidationError);
    expect(() => run([diff(R2, R3, {})])).toThrow(/built with/);
    expect(() => run([diff(R1, R2, {}), diff(R1, R3, {})])).toThrow(/chain/);
  });
});
