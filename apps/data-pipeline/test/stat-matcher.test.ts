import { describe, expect, it } from "vitest";
import { StatMatcher, shapeKey } from "../src/normalize/stat-matcher.ts";

// Synthetic stat descriptions in the raw snapshot shape. Invented texts and
// stat ids only: the matcher must work from data, not from game knowledge.
const desc = (
  scope: string,
  order: number,
  stats: string[],
  variants: {
    limit: [number | "#", number | "#"][];
    text: string;
    handlers?: { k: string; v: number | boolean }[];
  }[],
  tradeHash: number,
  parent?: string,
) => ({
  scope,
  order,
  stats,
  variants: variants.map((v) => ({ handlers: [], ...v })),
  tradeHash,
  ...(parent ? { parent } : {}),
});

const DESCRIPTIONS = {
  "base:1": desc(
    "base",
    1,
    ["fake_glow_+%"],
    [
      { limit: [[1, "#"]], text: "{0}% increased Glow" },
      { limit: [["#", -1]], text: "{0}% reduced Glow", handlers: [{ k: "negate", v: 1 }] },
    ],
    101,
  ),
  "base:2": desc(
    "base",
    2,
    ["fake_added_min", "fake_added_max"],
    [
      {
        limit: [
          ["#", "#"],
          ["#", "#"],
        ],
        text: "Adds {0} to {1} Sparkle",
      },
    ],
    102,
  ),
  "base:3": desc("base", 3, ["fake_flag"], [{ limit: [[1, 1]], text: "Cannot be Wobbled" }], 103),
  "base:4": desc(
    "base",
    4,
    ["fake_duration_ms"],
    [
      {
        limit: [["#", "#"]],
        text: "Lasts {0} seconds",
        handlers: [{ k: "milliseconds_to_seconds", v: 1 }],
      },
    ],
    104,
  ),
  "base:5": desc(
    "base",
    5,
    ["fake_two_lines"],
    [{ limit: [["#", "#"]], text: "First part {0:+d}\nsecond part" }],
    105,
  ),
  "base:6": desc(
    "base",
    6,
    ["fake_local_glow_+%"],
    [{ limit: [[1, "#"]], text: "{0}% increased Glow" }],
    106,
  ),
  "base:7": desc(
    "base",
    7,
    ["fake_hidden"],
    [{ limit: [[1, "#"]], text: "Something Hidden" }],
    107,
  ),
  "base:8": desc(
    "base",
    8,
    ["fake_plain"],
    [{ limit: [["#", "#"]], text: "{0:+d} Plainness" }],
    108,
  ),
  "base:9": desc(
    "base",
    9,
    ["fake_per_minute"],
    [
      {
        limit: [["#", "#"]],
        text: "Gain {0} Zest per second",
        handlers: [{ k: "per_minute_to_per_second_0dp", v: 1 }],
      },
    ],
    109,
  ),
  "base:10": desc(
    "base",
    10,
    ["fake_tenths"],
    [{ limit: [["#", "#"]], text: "{0}% Tenths", handlers: [{ k: "divide_by_ten_1dp", v: 1 }] }],
    110,
  ),
  "base:11": desc(
    "base",
    11,
    ["fake_distance"],
    [
      { limit: [[10, 10]], text: "Reach {0} Unit", handlers: [{ k: "divide_by_ten_1dp", v: 1 }] },
      {
        limit: [["#", "#"]],
        text: "Reach {0} Units",
        handlers: [{ k: "divide_by_ten_1dp", v: 1 }],
      },
    ],
    111,
  ),
  "child:1": desc(
    "child",
    1,
    ["fake_child_stat"],
    [{ limit: [["#", "#"]], text: "{0:+d} to Child Thing" }],
    201,
    "base",
  ),
};

const matcher = new StatMatcher(DESCRIPTIONS);

describe("StatMatcher.match", () => {
  it("maps a range line to stat id and raw range", () => {
    expect(matcher.match("Adds (1-2) to (5-7) Sparkle", "base")).toEqual({
      status: "matched",
      descriptionId: "base:2",
      stats: [
        { statId: "fake_added_min", min: 1, max: 2 },
        { statId: "fake_added_max", min: 5, max: 7 },
      ],
    });
  });

  it("inverts handlers (negate) and checks the variant limit", () => {
    expect(matcher.match("(10-20)% reduced Glow", "child")).toEqual({
      status: "matched",
      descriptionId: "base:1",
      stats: [{ statId: "fake_glow_+%", min: -20, max: -10 }],
    });
    const res = matcher.match("Lasts 1.5 seconds", "base");
    expect(res).toEqual({
      status: "matched",
      descriptionId: "base:4",
      stats: [{ statId: "fake_duration_ms", min: 1500, max: 1500 }],
    });
  });

  it("derives a hidden stat only from a fixed limit", () => {
    expect(matcher.match("Cannot be Wobbled", "base")).toEqual({
      status: "matched",
      descriptionId: "base:3",
      stats: [{ statId: "fake_flag", min: 1, max: 1 }],
    });
    expect(matcher.match("Something Hidden", "base")).toEqual({
      status: "unmatched",
      line: "Something Hidden",
    });
  });

  it("reports a value-less text whose stat may be any value as hidden, not matched", () => {
    const m = new StatMatcher({
      "h:1": {
        scope: "h",
        order: 1,
        stats: ["fake_any"],
        tradeHash: 5,
        variants: [{ limit: [["#", "#"]], text: "Does a Thing", handlers: [] }],
      },
    });
    expect(m.match("Does a Thing", "h")).toEqual({
      status: "hidden",
      line: "Does a Thing",
      descriptionId: "h:1",
      statIds: ["fake_any"],
    });
    expect(m.matchByHash(5, ["Does a Thing"], "h")).toMatchObject({ status: "hidden" });
  });

  it("reports two descriptions with the same text as ambiguous", () => {
    expect(matcher.match("15% increased Glow", "base")).toEqual({
      status: "ambiguous",
      line: "15% increased Glow",
      descriptionIds: ["base:1", "base:6"],
    });
  });

  it("follows the scope chain to the parent", () => {
    expect(matcher.match("+3 to Child Thing", "child")).toMatchObject({
      status: "matched",
      descriptionId: "child:1",
    });
    expect(matcher.match("Adds 1 to 2 Sparkle", "child")).toMatchObject({
      status: "matched",
      descriptionId: "base:2",
    });
    expect(matcher.match("+3 to Child Thing", "base")).toMatchObject({ status: "unmatched" });
  });

  it("does not match text that only resembles a template", () => {
    expect(matcher.match("Adds 1 to 2 Sparkle and more", "base")).toMatchObject({
      status: "unmatched",
    });
  });

  it("fails on an unknown scope", () => {
    expect(() => matcher.match("x", "nope")).toThrow(/unknown stat description scope/);
  });
});

describe("StatMatcher value handling", () => {
  it("reads PoB's negative range form -(a-b) as -a … -b", () => {
    expect(matcher.match("-(8-5) Plainness", "base")).toEqual({
      status: "matched",
      descriptionId: "base:8",
      stats: [{ statId: "fake_plain", min: -8, max: -5 }],
    });
  });

  it("reports a rounding handler whose raw value is not unique as lossy", () => {
    // 2 per second can come from several per-minute values
    expect(matcher.match("Gain 2 Zest per second", "base")).toEqual({
      status: "lossy",
      line: "Gain 2 Zest per second",
      descriptionId: "base:9",
    });
  });

  it("keeps a rounding handler that is exact for whole raw values", () => {
    expect(matcher.match("1.5% Tenths", "base")).toEqual({
      status: "matched",
      descriptionId: "base:10",
      stats: [{ statId: "fake_tenths", min: 15, max: 15 }],
    });
  });

  it("rejects a later variant when PoB would have used an earlier one", () => {
    expect(matcher.match("Reach 1 Units", "base")).toMatchObject({ status: "unmatched" });
    expect(matcher.match("Reach 1 Unit", "base")).toMatchObject({
      status: "matched",
      stats: [{ min: 10, max: 10 }],
    });
    expect(matcher.match("Reach 2 Units", "base")).toMatchObject({
      status: "matched",
      stats: [{ min: 20, max: 20 }],
    });
  });
});

describe("StatMatcher.matchByHash", () => {
  it("uses the trade hash to pick between same-text descriptions", () => {
    expect(matcher.matchByHash(106, ["(5-10)% increased Glow"], "base")).toEqual({
      status: "matched",
      descriptionId: "base:6",
      stats: [{ statId: "fake_local_glow_+%", min: 5, max: 10 }],
    });
    expect(matcher.matchByHash(101, ["(5-10)% reduced Glow"], "base")).toEqual({
      status: "matched",
      descriptionId: "base:1",
      stats: [{ statId: "fake_glow_+%", min: -10, max: -5 }],
    });
  });

  it("matches descriptions that render to several lines", () => {
    expect(matcher.matchByHash(105, ["First part +(2-4)", "second part"], "base")).toMatchObject({
      status: "matched",
      stats: [{ statId: "fake_two_lines", min: 2, max: 4 }],
    });
  });

  it("is unmatched for an unknown hash or a hash outside the scope chain", () => {
    expect(matcher.matchByHash(999, ["15% increased Glow"], "base")).toMatchObject({
      status: "unmatched",
    });
    expect(matcher.matchByHash(201, ["+3 to Child Thing"], "base")).toMatchObject({
      status: "unmatched",
    });
  });
});

describe("StatMatcher.matchLines", () => {
  it("joins following lines when a single line does not match", () => {
    const res = matcher.matchLines(["Adds 1 to 2 Sparkle", "First part +1", "second part"], "base");
    expect(res.map((r) => r.status)).toEqual(["matched", "matched"]);
  });
});

describe("shapeKey", () => {
  it("normalises every value form to #", () => {
    expect(shapeKey("+(5-8) to X, -3 and (1.5-2) or 12%")).toBe("# to X, # and # or #%");
  });
});

describe("constructor", () => {
  it("rejects malformed descriptions with their id", () => {
    expect(() => new StatMatcher({ "bad:1": { scope: "bad" } })).toThrow(/bad:1/);
  });
  it("accepts Lua's empty table {} for empty lists", () => {
    expect(
      () =>
        new StatMatcher({
          "s:1": { scope: "s", order: 1, stats: ["x"], variants: {}, tradeHash: 1 },
        }),
    ).not.toThrow();
  });
});
