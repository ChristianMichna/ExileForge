import { describe, expect, it } from "vitest";
import type { PipelineContext } from "../src/pipeline.js";
import { type GuideDraft, draftEntities, runGates } from "../src/stages/s10-validate.js";

const text = [{ type: "text" as const, text: "x" }];
const stage = (over: object = {}) => ({
  key: "st1",
  respecs: [],
  calcs: { mapping: { status: "ok", calcId: "c1" } },
  ...over,
});
const draft = (over: object = {}) =>
  ({
    progression: { stages: [stage()] },
    gear: {
      tiers: [
        {
          slots: [
            {
              slot: "Ring 1",
              acquisition: "craft",
              target: { kind: "crafted", baseItemId: "B", mods: [], socketables: [] },
              alternatives: [],
            },
          ],
        },
      ],
    },
    crafting: [{ key: "S8.craft-ring-1" }],
    mechanics: { explanation: [{ type: "entity", ref: { kind: "gem", id: "G" } }], decisions: [] },
    playstyle: { bossMechanics: [] },
    atlas: { avoidMods: [{ modId: "M", reason: text }] },
    variants: [],
    ...over,
  }) as never as GuideDraft;
const ctx = (known: (id: string) => boolean = () => true) =>
  ({
    catalog: {
      dataReleaseId: "poe2-1.0.0+r1",
      get: (r: { id: string }) => (known(r.id) ? {} : undefined),
    },
  }) as never as PipelineContext;
const codes = (d: GuideDraft, c = ctx()) =>
  runGates(c, d).flatMap((g) => g.findings.map((f) => `${g.gate}:${f.code}`));

describe("S10 gates", () => {
  it("collects the references of items, plans and prose", () => {
    const ids = draftEntities(draft()).map((e) => e.ref.id);
    expect(ids).toEqual(expect.arrayContaining(["B", "M", "G"]));
  });

  it("flags unknown entities (G1)", () => {
    expect(
      codes(
        draft(),
        ctx((id) => id !== "M"),
      ),
    ).toContain("G1:unknown_entity");
  });

  it("flags a failed stage calculation (G2)", () => {
    const d = draft({
      progression: {
        stages: [
          stage({ calcs: { mapping: { status: "failed", error: { code: "x", message: "y" } } } }),
        ],
      },
    });
    expect(codes(d)).toContain("G2:calc_failed");
  });

  it("flags respecs without a cost (G6) and a rare without a crafting plan (G7)", () => {
    const d = draft({
      progression: { stages: [stage({ respecs: ["n1"] })] },
      crafting: [],
    });
    expect(codes(d)).toEqual(
      expect.arrayContaining(["G6:respec_cost_missing", "G7:craft_plan_missing"]),
    );
  });

  it("never reports the unbuilt gates as passed", () => {
    const gates = runGates(ctx(), draft());
    for (const g of ["G3", "G4", "G5", "G8"]) {
      expect(gates.find((x) => x.gate === g)?.passed).toBe(false);
    }
  });
});
