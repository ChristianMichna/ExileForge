import { describe, expect, it } from "vitest";
import { CandidateComparisonView } from "../src/index.js";

const base = {
  runId: "run-1",
  catalogReleaseId: "poe2-9.8.7+r3",
  candidates: [],
  evaluations: [],
  names: {},
  results: {},
  unresolved: [],
};

describe("CandidateComparisonView", () => {
  it("accepts a view without a choice", () => {
    expect(CandidateComparisonView.safeParse(base).success).toBe(true);
  });
  it("accepts a chosen key", () => {
    expect(
      CandidateComparisonView.safeParse({ ...base, chosenKey: "S2.candidate-1" }).success,
    ).toBe(true);
  });
  it("rejects an empty run id and an empty chosen key", () => {
    expect(CandidateComparisonView.safeParse({ ...base, runId: "" }).success).toBe(false);
    expect(CandidateComparisonView.safeParse({ ...base, chosenKey: "" }).success).toBe(false);
  });
  it("rejects empty display names", () => {
    expect(CandidateComparisonView.safeParse({ ...base, names: { "skill:x": "" } }).success).toBe(
      false,
    );
  });
});
