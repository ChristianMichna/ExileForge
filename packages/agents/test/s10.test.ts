import { describe, expect, it } from "vitest";
import type { PipelineContext } from "../src/pipeline.js";
import {
  type GuideDraft,
  assembleDraft,
  draftEntities,
  runGates,
} from "../src/stages/s10-validate.js";

const text = [{ type: "text" as const, text: "x" }];
const STATE = {
  classId: "Cls",
  ascendancyId: "Asc",
  level: 10,
  tree: { allocated: [{ nodeId: "N1", weaponSet: 0 }], ascendancy: ["N2"] },
  skills: [
    {
      key: "k",
      role: "main",
      gem: { gemId: "GemMain", level: 1, quality: 0 },
      supports: [{ gemId: "GemSup", level: 1, quality: 0 }],
    },
  ],
  items: [{ slot: "Ring 1", item: { kind: "unique", uniqueId: "U1" } }],
  config: {},
};
const stage = (over: object = {}) => ({
  key: "st1",
  state: STATE,
  allocationOrder: [],
  tasks: [],
  dangers: [],
  rationale: [],
  respecs: [],
  calcs: { mapping: { status: "ok", calcId: "c1" } },
  ...over,
});
const draft = (over: object = {}) =>
  ({
    request: { mainSkillId: "GemReq", exclusions: [{ kind: "mod", id: "ExMod" }] },
    summary: { classId: "Cls", ascendancyId: "Asc", mainSkillId: "GemMain" },
    progression: { stages: [stage({ allocationOrder: ["N3"] })] },
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
    crafting: [
      {
        key: "S8.craft-ring-1",
        target: { kind: "unique", uniqueId: "T0" },
        start: { baseItemId: "S0", cost: { status: "uncalibrated", reason: "x" } },
        steps: [],
      },
    ],
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

  it("covers the plain ids of builds, plans, prices and the request", () => {
    const withPrice = draft({
      crafting: [
        {
          key: "S8.craft-ring-1",
          target: { kind: "unique", uniqueId: "Tgt" },
          start: {
            baseItemId: "StartBase",
            cost: { status: "ok", value: { amount: 1, currencyItemId: "Cur" } },
          },
          steps: [{ actionIds: ["Act"], goal: text }],
        },
      ],
    });
    const ids = draftEntities(withPrice).map((e) => e.ref.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "Cls",
        "Asc",
        "N1",
        "N2",
        "N3",
        "GemMain",
        "GemSup",
        "U1",
        "GemReq",
        "ExMod",
        "Tgt",
        "StartBase",
        "Act",
        "Cur",
      ]),
    );
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
      expect.arrayContaining(["G6:respec_cost_not_measured", "G7:craft_plan_missing"]),
    );
  });

  it("flags a stage without any calculation (G2)", () => {
    const d = draft({ progression: { stages: [stage({ calcs: {} })] } });
    expect(codes(d)).toContain("G2:calc_missing");
  });

  it("never lets a partly checked gate pass", () => {
    const gates = runGates(ctx(), draft());
    for (const g of ["G2", "G6", "G7"]) {
      expect(gates.find((x) => x.gate === g)?.findings.map((f) => f.code)).toContain(
        "check_not_built",
      );
    }
  });

  it("names the unreadable part when the draft cannot be assembled", () => {
    const c = { run: { request: {} }, result: () => undefined } as never as PipelineContext;
    expect(() =>
      assembleDraft(c, { chosen: {} as never, target: {} as never, mainSkillId: "G" }),
    ).toThrow(/unreadable/);
  });

  it("never reports the unbuilt gates as passed", () => {
    const gates = runGates(ctx(), draft());
    for (const g of ["G3", "G4", "G5", "G8"]) {
      expect(gates.find((x) => x.gate === g)?.passed).toBe(false);
    }
  });
});
