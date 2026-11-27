import { describe, expect, it } from "vitest";
import { CandidateComparisonView } from "../src/index.js";

const text = (t: string) => [{ type: "text", text: t }];
const candidate = (key: string) => ({
  key,
  title: "Fixture candidate",
  classId: "fixture_class",
  ascendancyId: "fixture_asc",
  damageRoute: text("route"),
  defenceConcept: text("defence"),
  keyEntities: [{ kind: "gem", id: "Fixture/Gems/Main" }],
  hypothesis: text("hypothesis"),
});
const skeleton = {
  classId: "fixture_class",
  ascendancyId: "fixture_asc",
  level: 10,
  tree: { allocated: [{ nodeId: "fixture_node_1" }] },
  skills: [
    {
      key: "main",
      role: "main",
      gem: { gemId: "Fixture/Gems/Main", level: 5 },
      supports: [],
    },
  ],
  items: [],
};
const result = {
  calcId: "calc-1",
  pobVersion: "v9.9.9",
  dataReleaseId: "poe2-9.8.7+r3",
  calcProfile: "fixture-profile",
  inputHash: "a".repeat(64),
  computedAt: "2026-01-01T00:00:00Z",
  stats: { FixtureStatA: 1 },
  warnings: [],
  unsupportedMods: [],
};
const evaluation = (key: string, calcs: object) => ({
  candidateKey: key,
  skeleton,
  calcs: { "fixture-profile": calcs },
});
const base = {
  runId: "run-1",
  catalogReleaseId: "poe2-9.8.7+r3",
  current: true,
  candidates: [candidate("c1"), candidate("c2")],
  evaluations: [
    evaluation("c1", { status: "ok", calcId: "calc-1" }),
    evaluation("c2", {
      status: "failed",
      error: { code: "calc-failed", message: "fixture failure" },
    }),
  ],
  names: { "gem:Fixture/Gems/Main": "Fixture Skill" },
  results: { "calc-1": result },
  unresolved: [],
};
const ok = (v: unknown) => CandidateComparisonView.safeParse(v).success;

describe("CandidateComparisonView", () => {
  it("accepts candidates with ok and failed evaluations", () => {
    expect(CandidateComparisonView.safeParse(base).error?.issues).toBeUndefined();
  });
  it("accepts an empty run and a chosen candidate", () => {
    expect(ok({ ...base, candidates: [], evaluations: [], results: {} })).toBe(true);
    expect(ok({ ...base, chosenKey: "c2" })).toBe(true);
  });
  it("requires the release flag", () => {
    const rest: Record<string, unknown> = { ...base };
    delete rest.current;
    expect(ok(rest)).toBe(false);
  });
  it("rejects a chosen key that is not a candidate", () => {
    expect(ok({ ...base, chosenKey: "nope" })).toBe(false);
  });
  it("rejects duplicate candidates and stray or repeated evaluations", () => {
    expect(ok({ ...base, candidates: [candidate("c1"), candidate("c1")] })).toBe(false);
    expect(
      ok({
        ...base,
        evaluations: [evaluation("zz", { status: "failed", error: { code: "x", message: "x" } })],
      }),
    ).toBe(false);
    expect(ok({ ...base, evaluations: [base.evaluations[1], base.evaluations[1]] })).toBe(false);
  });
  it("rejects a result stored under another id", () => {
    expect(ok({ ...base, results: { "calc-9": result } })).toBe(false);
  });
  it("rejects a missing result unless it is listed as unresolved", () => {
    expect(ok({ ...base, results: {} })).toBe(false);
    expect(ok({ ...base, results: {}, unresolved: ["calc:calc-1"] })).toBe(true);
  });
  it("rejects empty ids and empty display names", () => {
    expect(ok({ ...base, runId: "" })).toBe(false);
    expect(ok({ ...base, names: { "gem:x": "" } })).toBe(false);
  });
});
