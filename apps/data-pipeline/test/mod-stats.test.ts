import { describe, expect, it } from "vitest";
import { modLines, resolveModStats } from "../src/normalize/mod-stats.ts";
import { StatMatcher } from "../src/normalize/stat-matcher.ts";

// Synthetic data only (invented stat ids and texts).
const matcher = new StatMatcher({
  "s:1": {
    scope: "s",
    order: 1,
    stats: ["fake_a"],
    tradeHash: 11,
    variants: [{ limit: [["#", "#"]], text: "{0:+d} to Alpha", handlers: [] }],
  },
  "s:2": {
    scope: "s",
    order: 2,
    stats: ["fake_b"],
    tradeHash: 22,
    variants: [{ limit: [["#", "#"]], text: "{0}% more Beta", handlers: [] }],
  },
  "s:3": {
    scope: "s",
    order: 3,
    stats: ["fake_b_local"],
    tradeHash: 33,
    variants: [{ limit: [["#", "#"]], text: "{0}% more Beta", handlers: [] }],
  },
});

describe("modLines", () => {
  it("reads the numbered lines in order and stops at the first gap", () => {
    expect(modLines({ "1": "a", "2": "b", "4": "d", type: "Prefix" })).toEqual(["a", "b"]);
  });
});

describe("resolveModStats", () => {
  it("resolves via trade hash, falls back to text and lists the rest", () => {
    const mods = {
      ModHash: { "1": "(1-3)% more Beta", tradeHashes: { "33": ["(1-3)% more Beta"] } },
      ModText: { "1": "+5 to Alpha" },
      ModAmbiguous: { "1": "4% more Beta" },
      ModUnknown: { "1": "+(1-2) to Gamma", tradeHashes: { "99": ["+(1-2) to Gamma"] } },
    };
    const { results, summary } = resolveModStats(mods, matcher, "s");
    expect(results).toEqual([
      {
        modId: "ModAmbiguous",
        stats: [],
        unresolved: [{ lines: ["4% more Beta"], reason: "ambiguous" }],
        emptyGroupHashes: [],
      },
      {
        modId: "ModHash",
        stats: [{ statId: "fake_b_local", min: 1, max: 3 }],
        unresolved: [],
        emptyGroupHashes: [],
      },
      {
        modId: "ModText",
        stats: [{ statId: "fake_a", min: 5, max: 5 }],
        unresolved: [],
        emptyGroupHashes: [],
      },
      {
        modId: "ModUnknown",
        stats: [],
        unresolved: [{ lines: ["+(1-2) to Gamma"], reason: "unmatched" }],
        emptyGroupHashes: [],
      },
    ]);
    expect(summary).toEqual({
      mods: 4,
      modsFullyResolved: 2,
      lineGroups: 4,
      lineGroupsResolved: 2,
      emptyGroups: 0,
    });
  });

  it("lists trade-hash groups that render no text instead of resolving them", () => {
    const { results, summary } = resolveModStats(
      { M: { "1": "+1 to Alpha", tradeHashes: { "11": ["+1 to Alpha"], "44": [""] } } },
      matcher,
      "s",
    );
    expect(results[0]).toMatchObject({
      stats: [{ statId: "fake_a", min: 1, max: 1 }],
      unresolved: [],
      emptyGroupHashes: ["44"],
    });
    expect(summary).toMatchObject({ emptyGroups: 1, lineGroups: 1 });
  });

  it("marks lines without trade hash that do not match", () => {
    const { results } = resolveModStats({ M: { "1": "Nothing like it" } }, matcher, "s");
    expect(results[0]?.unresolved).toEqual([
      { lines: ["Nothing like it"], reason: "no-trade-hash" },
    ]);
  });

  it("rejects a trade hash without lines", () => {
    expect(() =>
      resolveModStats({ M: { "1": "+1 to Alpha", tradeHashes: { "11": {} } } }, matcher, "s"),
    ).toThrow(/lists no lines/);
  });

  it("rejects a mod that is not an object", () => {
    expect(() => resolveModStats({ M: "text" }, matcher, "s")).toThrow(/mod M/);
  });
});
