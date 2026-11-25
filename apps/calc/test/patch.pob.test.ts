import type { BuildHandle, CalcResult, PatchOp } from "@exileforge/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CalcPool } from "../src/index.ts";
import { golden, havePob, startPobPool } from "./pob-setup.ts";

/*
 * build.applyPatch against the real PoB. Every id used here (node ids, gem
 * ids, slot names, item texts) is read from the golden build files, never
 * written from memory. Tests compare PoB results with each other, not with
 * hand-written numbers.
 */

const FIXTURE = "pr2-synthetic-fixture";

function decodeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Facts read from a build XML: allocated nodes, first gem, equipped slots with their item text. */
function readBuild(xml: string): {
  nodes: string[];
  gemId: string;
  slots: { name: string; itemText: string }[];
} {
  const nodes = /<Spec [^>]*nodes="([^"]*)"/.exec(xml)?.[1]?.split(",") ?? [];
  const gemId = /<Gem [^>]*gemId="([^"]+)"/.exec(xml)?.[1] ?? "";
  const items = new Map<string, string>();
  for (const m of xml.matchAll(/<Item id="(\d+)"[^>]*>([\s\S]*?)<\/Item>/g)) {
    if (m[1] && m[2]) items.set(m[1], decodeXmlText(m[2].replace(/<ModRange[^>]*\/>/g, "")).trim());
  }
  const slots: { name: string; itemText: string }[] = [];
  for (const m of xml.matchAll(/<Slot itemId="(\d+)"[^>]*name="([^"]+)"/g)) {
    const text = m[1] ? items.get(m[1]) : undefined;
    if (m[2] && text) slots.push({ name: m[2], itemText: text });
  }
  return { nodes, gemId, slots };
}

describe.skipIf(!havePob)("build.applyPatch with headless Path of Building", () => {
  let pool: CalcPool;
  let xml: string;
  let base: BuildHandle;
  let baseResult: CalcResult;
  const facts = {
    nodes: [] as string[],
    gemId: "",
    slots: [] as { name: string; itemText: string }[],
  };

  const stats = (
    handle: BuildHandle,
    profile = "as-saved",
    mainSkill?: string,
  ): Promise<CalcResult> =>
    pool.request("calc.stats", { handle, profile, ...(mainSkill ? { mainSkill } : {}) });
  const patch = (ops: PatchOp[], handle = base) =>
    pool.request("build.applyPatch", { handle, ops });
  const ops = (o: unknown[]): PatchOp[] => o as PatchOp[];
  /** The numbers of a state must not depend on whether PoB holds it in memory or loaded it from its XML. */
  const expectRoundTrip = async (handle: BuildHandle): Promise<void> => {
    const inMemory = await stats(handle);
    const exported = await pool.request("build.export", { handle, format: "xml" });
    const reloaded = await pool.request("build.load", { format: "xml", payload: exported.payload });
    const again = await stats(reloaded.handle);
    expect(again.stats).toEqual(inMemory.stats);
    expect(again.calcId).toBe(inMemory.calcId);
    await pool.request("build.release", { handle: reloaded.handle });
  };

  beforeAll(async () => {
    pool = await startPobPool(2);
    xml = await golden(FIXTURE);
    Object.assign(facts, readBuild(xml));
    expect(facts.nodes.length).toBeGreaterThan(2);
    expect(facts.gemId).not.toBe("");
    expect(facts.slots.length).toBeGreaterThan(0);
    base = (await pool.request("build.load", { format: "xml", payload: xml })).handle;
    baseResult = await stats(base);
  });

  afterAll(async () => {
    await pool.close();
  });

  it("returns a new state and leaves the original untouched", async () => {
    const { handle } = await patch(ops([{ op: "setConfig", key: "enemyIsBoss", value: "None" }]));
    expect(handle).not.toBe(base);
    const patched = await stats(handle);
    expect(patched.inputHash).not.toBe(baseResult.inputHash);
    // same PoB option as the test-override profile, applied into the build instead
    const viaProfile = await stats(base, "test-override");
    expect(patched.stats).toEqual(viaProfile.stats);
    expect((await stats(base)).stats).toEqual(baseResult.stats);
  });

  it("gives the same numbers in memory, after export and reload, and on every worker", async () => {
    const { handle } = await patch(ops([{ op: "setLevel", level: 61 }]));
    const inMemory = await stats(handle);
    expect(inMemory.stats.Life).not.toBe(baseResult.stats.Life);
    const exported = await pool.request("build.export", { handle, format: "xml" });
    expect(exported.payload).toMatch(/level="61"/);
    const reloaded = await pool.request("build.load", { format: "xml", payload: exported.payload });
    const again = await stats(reloaded.handle);
    expect(again.stats).toEqual(inMemory.stats);
    expect(again.calcId).toBe(inMemory.calcId);
    const spread = await Promise.all(Array.from({ length: 6 }, () => stats(handle)));
    expect(new Set(spread.map((r) => r.calcId))).toEqual(new Set([inMemory.calcId]));
  });

  it("deallocates and reallocates passives", async () => {
    const last = facts.nodes[facts.nodes.length - 1] ?? "";
    const without = await patch(ops([{ op: "deallocateNodes", nodeIds: [last] }]));
    const exportedWithout = (
      await pool.request("build.export", { handle: without.handle, format: "xml" })
    ).payload;
    const nodesWithout = readBuild(exportedWithout).nodes;
    expect(nodesWithout.length).toBeLessThan(facts.nodes.length);
    expect(nodesWithout).not.toContain(last);

    const back = await patch(ops([{ op: "allocateNodes", nodeIds: facts.nodes }]), without.handle);
    const exportedBack = (
      await pool.request("build.export", { handle: back.handle, format: "xml" })
    ).payload;
    expect(new Set(readBuild(exportedBack).nodes)).toEqual(new Set(facts.nodes));
    expect((await stats(back.handle)).stats).toEqual(baseResult.stats);
  });

  it("removes and re-equips an item from its item text", async () => {
    const slot = facts.slots[0];
    if (!slot) throw new Error("fixture has no equipped item");
    const removed = await patch(ops([{ op: "removeItem", slot: slot.name }]));
    expect((await stats(removed.handle)).stats).not.toEqual(baseResult.stats);
    const back = await patch(
      ops([{ op: "setItem", slot: slot.name, itemText: slot.itemText }]),
      removed.handle,
    );
    expect((await stats(back.handle)).stats).toEqual(baseResult.stats);
  });

  it("adds a skill group that can be picked as main skill", async () => {
    const { handle } = await patch(
      ops([
        {
          op: "setSkill",
          groupKey: "exileforge-test",
          gemId: facts.gemId,
          level: 1,
          quality: 0,
          supports: [],
        },
      ]),
    );
    const res = await stats(handle, "as-saved", "exileforge-test");
    expect(res.mainSkill).toBe("exileforge-test");
    expect(res.stats.CombinedDPS).toBeGreaterThan(0);
    expect(res.stats.CombinedDPS).not.toBe(baseResult.stats.CombinedDPS);
    const removed = await patch(ops([{ op: "removeSkill", groupKey: "exileforge-test" }]), handle);
    expect((await stats(removed.handle)).stats).toEqual(baseResult.stats);
  });

  it("sets class and ascendancy by their catalog ids", async () => {
    const other = await golden("pobb-ljOBlCON5WGB");
    const classId = /<Build [^>]*className="([^"]+)"/.exec(other)?.[1] ?? "";
    const ascendancyId = /<Spec [^>]*ascendancyInternalId="([^"]+)"/.exec(other)?.[1] ?? "";
    expect(classId && ascendancyId).toBeTruthy();
    const { handle } = await pool.request("build.load", { format: "xml", payload: other });
    const before = await stats(handle);
    // the build's own class and ascendancy: a no-op that must not change a number
    const same = await patch(
      ops([
        { op: "setClass", classId },
        { op: "setAscendancy", ascendancyId },
      ]),
      handle,
    );
    expect((await stats(same.handle)).stats).toEqual(before.stats);
    // the fixture has no ascendancy yet; this one belongs to another class
    await expect(patch(ops([{ op: "setAscendancy", ascendancyId }]))).rejects.toMatchObject({
      kind: "invalid_params",
    });
  });

  it("gives the same numbers in memory and after reload for every kind of op", async () => {
    const last = facts.nodes[facts.nodes.length - 1] ?? "";
    const slot = facts.slots[0];
    if (!slot) throw new Error("fixture has no equipped item");
    const variants: unknown[][] = [
      [{ op: "setConfig", key: "enemyIsBoss", value: "None" }],
      [{ op: "deallocateNodes", nodeIds: [last] }],
      [
        { op: "deallocateNodes", nodeIds: [last] },
        { op: "allocateNodes", nodeIds: [last], weaponSet: 1 },
      ],
      [{ op: "removeItem", slot: slot.name }],
      [
        {
          op: "setSkill",
          groupKey: "exileforge-test",
          gemId: facts.gemId,
          level: 1,
          quality: 0,
          supports: [],
        },
      ],
    ];
    for (const o of variants) {
      const { handle } = await patch(ops(o));
      await expectRoundTrip(handle);
    }
  });

  it("accepts weaponSet 0 as the shared tree", async () => {
    const last = facts.nodes[facts.nodes.length - 1] ?? "";
    const without = await patch(ops([{ op: "deallocateNodes", nodeIds: [last] }]));
    // the same ops as without weaponSet, so the result must be the same state
    const plain = await patch(ops([{ op: "allocateNodes", nodeIds: facts.nodes }]), without.handle);
    const zero = await patch(
      ops([{ op: "allocateNodes", nodeIds: facts.nodes, weaponSet: 0 }]),
      without.handle,
    );
    expect((await stats(zero.handle)).calcId).toBe((await stats(plain.handle)).calcId);
  });

  it("keeps profile and main skill out of the patched build", async () => {
    // run a profile and a main skill on the base first; the patch must not carry them
    const viaProfile = await stats(base, "test-override", baseResult.mainSkill ?? undefined);
    expect(viaProfile.stats).not.toEqual(baseResult.stats);
    const { handle } = await patch(ops([{ op: "setLevel", level: 61 }]));
    const plain = await patch(ops([{ op: "setLevel", level: 61 }]), base);
    expect((await stats(handle)).stats).toEqual((await stats(plain.handle)).stats);
    expect((await stats(handle)).calcProfile).toBe("as-saved");
  });

  it("evaluates candidates as deltas against the base, equal to separate calculations", async () => {
    const metrics = ["Life", "CombinedDPS"];
    const res = await pool.request("calc.evalBatch", {
      handle: base,
      profile: "as-saved",
      metrics,
      candidates: [
        { key: "level", ops: ops([{ op: "setLevel", level: 61 }]) },
        { key: "broken", ops: ops([{ op: "setClass", classId: "exileforge-no-such-class" }]) },
      ],
    });
    expect(res.base.calcId).toBe(baseResult.calcId);
    const [level, broken] = res.results;
    const direct = await stats((await patch(ops([{ op: "setLevel", level: 61 }]))).handle);
    expect(level?.ok).toBe(true);
    if (level?.ok) {
      expect(level.calcId).toBe(direct.calcId);
      for (const m of metrics) {
        expect(level.deltas[m]).toBe((direct.stats[m] ?? NaN) - (baseResult.stats[m] ?? NaN));
      }
    }
    expect(broken).toMatchObject({ ok: false, error: { kind: "invalid_params" } });
  });

  it("rejects bad ops with the op index and leaves no half-patched state", async () => {
    const bad: [unknown[], RegExp][] = [
      [
        [
          { op: "setLevel", level: 70 },
          { op: "allocateNodes", nodeIds: ["999999999"] },
        ],
        /op 2 \(allocateNodes\)/,
      ],
      [[{ op: "setClass", classId: "exileforge-no-such-class" }], /op 1 \(setClass\)/],
      [[{ op: "setAscendancy", ascendancyId: "exileforge-no-such-ascendancy" }], /op 1/],
      [
        [
          {
            op: "setSkill",
            groupKey: "x",
            gemId: "exileforge/no-such-gem",
            level: 1,
            quality: 0,
            supports: [],
          },
        ],
        /op 1/,
      ],
      [[{ op: "removeSkill", groupKey: "exileforge-no-such-group" }], /op 1/],
      [[{ op: "setItem", slot: "exileforge-no-such-slot", itemText: "x" }], /op 1/],
      [[{ op: "allocateNodes", nodeIds: [facts.nodes[0] ?? ""], weaponSet: 7 }], /op 1/],
      [[{ op: "setLevel", level: 101 }], /op 1/],
      [
        [
          {
            op: "setSkill",
            groupKey: "x",
            gemId: facts.gemId,
            level: 1,
            quality: 0,
            supports: [],
            weaponSet: 1,
          },
        ],
        /op 1/,
      ],
      [[{ op: "setItem", slot: facts.slots[0]?.name ?? "", itemText: "not an item" }], /op 1/],
      [[{ op: "setConfig", key: "exileforgeNoSuchOption", value: true }], /op 1/],
      [[{ op: "setConfig", key: "enemyIsBoss", value: "exileforge-no-such-value" }], /op 1/],
    ];
    for (const [o, detail] of bad) {
      await expect(patch(ops(o))).rejects.toMatchObject({
        kind: "invalid_params",
        detail: expect.stringMatching(detail),
      });
    }
    expect((await stats(base)).stats).toEqual(baseResult.stats);
  });
});
