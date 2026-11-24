import { describe, expect, it } from "vitest";
import { diffEntities, diffValue } from "../src/diff/diff.ts";

// Synthetic entities only: the diff is generic and must not depend on game data.
describe("diffValue", () => {
  it("returns no changes for equal values regardless of key order", () => {
    expect(diffValue({ a: 1, b: [1, { c: "x" }] }, { b: [1, { c: "x" }], a: 1 })).toEqual([]);
  });

  it("reports changed, added and removed object fields as JSON pointers", () => {
    expect(
      diffValue(
        { a: 1, gone: true, nested: { v: "old" } },
        { a: 2, nested: { v: "new" }, fresh: null },
      ),
    ).toEqual([
      { path: "/a", before: 1, after: 2 },
      { path: "/fresh", after: null },
      { path: "/gone", before: true },
      { path: "/nested/v", before: "old", after: "new" },
    ]);
  });

  it("compares equal-length arrays per index", () => {
    expect(diffValue({ list: [1, 2, 3] }, { list: [1, 5, 3] })).toEqual([
      { path: "/list/1", before: 2, after: 5 },
    ]);
  });

  it("reports a length change as one change of the whole array", () => {
    expect(diffValue({ list: [1, 2] }, { list: [1, 2, 3] })).toEqual([
      { path: "/list", before: [1, 2], after: [1, 2, 3] },
    ]);
  });

  it("escapes ~ and / in pointer segments (RFC 6901)", () => {
    expect(diffValue({ "a/b": 1, "c~d": 1 }, { "a/b": 2, "c~d": 2 })).toEqual([
      { path: "/a~1b", before: 1, after: 2 },
      { path: "/c~0d", before: 1, after: 2 },
    ]);
  });

  it("reports a type change at the field itself", () => {
    expect(diffValue({ v: { x: 1 } }, { v: [1] })).toEqual([
      { path: "/v", before: { x: 1 }, after: [1] },
    ]);
  });

  it("distinguishes null from a missing field", () => {
    expect(diffValue({ v: null }, {})).toEqual([{ path: "/v", before: null }]);
  });
});

describe("diffEntities", () => {
  it("lists added, removed and changed ids sorted", () => {
    const before = { "Fake/B": { n: 1 }, "Fake/A": { n: 1 }, "Fake/Gone": { n: 0 } };
    const after = { "Fake/A": { n: 1 }, "Fake/B": { n: 2 }, "Fake/New2": {}, "Fake/New1": {} };
    expect(diffEntities(before, after)).toEqual({
      added: ["Fake/New1", "Fake/New2"],
      removed: ["Fake/Gone"],
      changed: [{ id: "Fake/B", fields: [{ path: "/n", before: 1, after: 2 }] }],
    });
  });

  it("is empty for identical maps", () => {
    const m = { x: { a: [1, 2] } };
    expect(diffEntities(m, structuredClone(m))).toEqual({ added: [], removed: [], changed: [] });
  });
});
