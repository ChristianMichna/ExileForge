import { describe, expect, it } from "vitest";
import { PatchStatus } from "../src/index.js";

const base = {
  schemaVersion: 1,
  guideId: "0b0f6d6e-3a3a-4c1e-9a53-6c1f2f6f9a11",
  guideRevision: 2,
  fromReleaseId: "poe2-9.8.7+r3",
  toReleaseId: "poe2-9.8.8+r1",
  chain: ["poe2-9.8.7+r3", "poe2-9.8.8+r1"],
  checkedAt: "2026-11-26T05:00:00Z",
  checkedReferences: 3,
};
const changed = {
  ref: { kind: "mod", id: "mod-a" },
  impact: "changed",
  locations: ["/gear/0"],
  fields: [{ path: "/stats/0/max", before: 5, after: 7 }],
};
const removed = { ref: { kind: "gem", id: "gem-b" }, impact: "removed", locations: ["/summary"] };

describe("PatchStatus", () => {
  it("accepts a verdict that follows from the findings", () => {
    expect(PatchStatus.safeParse({ ...base, verdict: "unaffected", findings: [] }).success).toBe(
      true,
    );
    expect(
      PatchStatus.safeParse({ ...base, verdict: "needs-recalc", findings: [changed] }).success,
    ).toBe(true);
    expect(
      PatchStatus.safeParse({ ...base, verdict: "broken", findings: [changed, removed] }).success,
    ).toBe(true);
  });
  it("rejects a verdict that does not match", () => {
    expect(
      PatchStatus.safeParse({ ...base, verdict: "unaffected", findings: [changed] }).success,
    ).toBe(false);
    expect(
      PatchStatus.safeParse({ ...base, verdict: "needs-recalc", findings: [removed] }).success,
    ).toBe(false);
    expect(PatchStatus.safeParse({ ...base, verdict: "broken", findings: [] }).success).toBe(false);
  });
  it("treats a changed release fact as needs-recalc and checks the chain", () => {
    const facts = { ...base, findings: [], factChanges: ["pobVersion"] };
    expect(PatchStatus.safeParse({ ...facts, verdict: "needs-recalc" }).success).toBe(true);
    expect(PatchStatus.safeParse({ ...facts, verdict: "unaffected" }).success).toBe(false);
    const ok = { ...base, verdict: "unaffected", findings: [] };
    const mid = "poe2-9.8.7+r4";
    expect(
      PatchStatus.safeParse({ ...ok, chain: [base.fromReleaseId, mid, base.toReleaseId] }).success,
    ).toBe(true);
    expect(
      PatchStatus.safeParse({ ...ok, chain: [base.toReleaseId, base.fromReleaseId] }).success,
    ).toBe(false);
    expect(
      PatchStatus.safeParse({ ...ok, chain: [base.fromReleaseId, mid, mid, base.toReleaseId] })
        .success,
    ).toBe(false);
    expect(PatchStatus.safeParse({ ...ok, chain: [base.fromReleaseId] }).success).toBe(false);
  });
  it("offers candidates only for removed entities and keeps stage ids", () => {
    const withCand = { ...removed, candidates: [{ kind: "gem", id: "gem-c" }], stageIds: ["s1"] };
    expect(
      PatchStatus.safeParse({ ...base, verdict: "broken", findings: [withCand] }).success,
    ).toBe(true);
    const bad = { ...changed, candidates: [{ kind: "mod", id: "mod-z" }] };
    expect(
      PatchStatus.safeParse({ ...base, verdict: "needs-recalc", findings: [bad] }).success,
    ).toBe(false);
  });
  it("needs fields for changed and none for removed", () => {
    const noFields = { ...changed, fields: undefined };
    expect(
      PatchStatus.safeParse({ ...base, verdict: "needs-recalc", findings: [noFields] }).success,
    ).toBe(false);
    const withFields = { ...removed, fields: changed.fields };
    expect(
      PatchStatus.safeParse({ ...base, verdict: "broken", findings: [withFields] }).success,
    ).toBe(false);
  });
  it("rejects equal releases, duplicate references and more findings than references", () => {
    const ok = { ...base, verdict: "needs-recalc", findings: [changed] };
    expect(PatchStatus.safeParse({ ...ok, toReleaseId: base.fromReleaseId }).success).toBe(false);
    expect(PatchStatus.safeParse({ ...ok, findings: [changed, changed] }).success).toBe(false);
    expect(PatchStatus.safeParse({ ...ok, checkedReferences: 0 }).success).toBe(false);
  });
});

describe("guide.revalidate", () => {
  it("takes ids only and answers with a PatchStatus", async () => {
    const { GuideTools } = await import("../src/index.js");
    const tool = GuideTools["guide.revalidate"];
    const input = {
      guideId: "0b0f6d6e-3a3a-4c1e-9a53-6c1f2f6f9a11",
      toReleaseId: "poe2-9.8.8+r1",
    };
    expect(tool.input.safeParse(input).success).toBe(true);
    expect(tool.input.safeParse({ ...input, path: "/etc" }).success).toBe(true);
    expect(tool.input.parse({ ...input, path: "/etc" })).toEqual(input);
    expect(tool.input.safeParse({ ...input, toReleaseId: "../x" }).success).toBe(false);
    expect(tool.input.safeParse({ guideId: "x", toReleaseId: input.toReleaseId }).success).toBe(
      false,
    );
  });
});
