import { describe, expect, it } from "vitest";
import type { StageConfig } from "../src/config.js";
import type { PipelineContext } from "../src/pipeline.js";
import {
  CRITIC_SECTIONS,
  CriticVerdict,
  afterReport,
  reportIsCurrent,
  type GuideDraft,
  assembleDraft,
  criticTask,
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
          calcs: { mapping: { status: "ok", calcId: "c1" } },
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
const codes = async (d: GuideDraft, c = ctx(), cfg?: never) =>
  (await runGates(c, d, cfg)).flatMap((g) => g.findings.map((f) => `${g.gate}:${f.code}`));

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

  it("flags unknown entities (G1)", async () => {
    expect(
      await codes(
        draft(),
        ctx((id) => id !== "M"),
      ),
    ).toContain("G1:unknown_entity");
  });

  it("flags a failed stage calculation (G2)", async () => {
    const d = draft({
      progression: {
        stages: [
          stage({ calcs: { mapping: { status: "failed", error: { code: "x", message: "y" } } } }),
        ],
      },
    });
    expect(await codes(d)).toContain("G2:calc_failed");
  });

  it("flags respecs without a cost (G6) and a rare without a crafting plan (G7)", async () => {
    const d = draft({
      progression: { stages: [stage({ respecs: ["n1"] })] },
      crafting: [],
    });
    expect(await codes(d)).toEqual(
      expect.arrayContaining(["G6:respec_cost_not_measured", "G7:craft_plan_missing"]),
    );
  });

  it("flags a stage without any calculation (G2)", async () => {
    const d = draft({ progression: { stages: [stage({ calcs: {} })] } });
    expect(await codes(d)).toContain("G2:calc_missing");
  });

  it("never lets a partly checked gate pass", async () => {
    const gates = await runGates(ctx(), draft());
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

  it("never reports the unbuilt gates as passed", async () => {
    const gates = await runGates(ctx(), draft());
    for (const g of ["G3", "G4", "G5", "G8"]) {
      expect(gates.find((x) => x.gate === g)?.passed).toBe(false);
    }
  });
});

describe("S10 measured gates", () => {
  const cfg = {
    calcProfile: "mapping",
    stats: {
      spiritFree: "Sp",
      resistMissing: ["MissFire", "MissCold"],
      attributes: [{ have: "A", need: "ReqA" }],
      ehp: "Ehp",
      dps: "Dps",
    },
    resistanceCapStageKinds: ["endgame"],
    thresholds: [
      { fromLevel: 10, minEhp: 100, minDps: 1000 },
      { fromLevel: 50, minEhp: 400 },
    ],
  };
  const withStats = (stats: Record<string, number> | undefined, profile = "mapping") =>
    ({
      ...(ctx() as object),
      calc: {
        getResult: () =>
          Promise.resolve(stats === undefined ? undefined : { calcProfile: profile, stats }),
      },
    }) as never as PipelineContext;
  const stageAt = (level: number, kind = "endgame") =>
    draft({
      progression: { stages: [stage({ kind, state: { ...STATE, level } })] },
    });
  const run = async (
    stats: Record<string, number> | undefined,
    level = 90,
    over: object = {},
    kind = "endgame",
  ) =>
    (await runGates(withStats(stats), stageAt(level, kind), { ...cfg, ...over } as never)).flatMap(
      (g) => g.findings.map((f) => `${g.gate}:${f.code}`),
    );
  const good = { Sp: 5, MissFire: 0, MissCold: 0, Ehp: 500, Dps: 5000, A: 100, ReqA: 80 };

  it("passes G4 and G5 when every measured value meets the configured limits", async () => {
    const gates = await runGates(withStats(good), stageAt(90), cfg as never);
    expect(gates.find((g) => g.gate === "G4")?.passed).toBe(true);
    expect(gates.find((g) => g.gate === "G5")?.passed).toBe(true);
    expect(gates.find((g) => g.gate === "G3")?.passed).toBe(false);
  });

  it("flags overdrawn spirit, resistances missing to the cap and values below the minimums", async () => {
    const codes = await run({ Sp: -1, MissFire: 5, MissCold: 0, Ehp: 5, Dps: 5 });
    expect(codes).toEqual(
      expect.arrayContaining([
        "G3:spirit_overdrawn",
        "G4:resistance_below_cap",
        "G4:ehp_below_minimum",
        "G5:dps_below_minimum",
      ]),
    );
  });

  it("flags an attribute below the requirement of an item or gem (G3)", async () => {
    expect(await run({ ...good, A: 70 })).toContain("G3:attribute_requirement_unmet");
    expect(await run(good)).not.toContain("G3:attribute_requirement_unmet");
    expect(await run({ ...good, ReqA: undefined as never })).toContain("G3:stat_missing");
  });

  it("checks the allocated passives against the points of the stage table (G3)", async () => {
    const release = {
      id: "r",
      maxCharacterLevel: { value: 5, origin: "pob-code" },
      passivePoints: {
        mainTree: { perLevel: 1, fromLevel: 1, origin: "pob-code" },
        weaponSetByAct: { acts: [{ act: 1, areaLevel: 5, points: 0 }], origin: "pob-code" },
      },
    };
    const base = withStats(good) as unknown as { catalog: object };
    const c = { ...base, catalog: { ...base.catalog, release } } as never as PipelineContext;
    const nodes = (n: number) => ({
      ...STATE,
      level: 5,
      tree: {
        allocated: Array.from({ length: n }, (_, i) => ({ nodeId: `N${String(i)}`, weaponSet: 0 })),
        ascendancy: [],
      },
    });
    const at = async (n: number, key = "act-1") =>
      (
        await runGates(
          c,
          draft({ progression: { stages: [stage({ key, kind: "campaign", state: nodes(n) })] } }),
          cfg as never,
        )
      ).flatMap((g) => g.findings.map((f) => `${g.gate}:${f.code}`));
    expect(await at(5)).not.toContain("G3:points_overspent");
    expect(await at(6)).toContain("G3:points_overspent");
    expect(await at(1, "other")).toContain("G3:points_unknown");
  });

  it("separates a missing stat from a value below the minimum", async () => {
    const codes = await run({ Sp: 1, MissFire: 0, MissCold: 0, A: 1, ReqA: 1 });
    expect(codes).toEqual(expect.arrayContaining(["G4:stat_missing", "G5:stat_missing"]));
    expect(codes).not.toContain("G4:ehp_below_minimum");
  });

  it("resolves each minimum on its own by level and flags a level without one", async () => {
    // level 60: minEhp 400 applies, minDps still comes from the entry at level 10
    expect(await run({ ...good, Ehp: 300 }, 60)).toContain("G4:ehp_below_minimum");
    expect(await run({ ...good, Dps: 500 }, 60)).toContain("G5:dps_below_minimum");
    // level 5 is below the smallest fromLevel: not checked, so the gate cannot pass
    const codes = await run(good, 5);
    expect(codes).toEqual(expect.arrayContaining(["G4:threshold_missing", "G5:threshold_missing"]));
  });

  it("measures the endgame stage with the gear of the last tier and sends findings to S7", async () => {
    const ids: string[] = [];
    const ctxSeen = {
      ...(ctx() as object),
      calc: {
        getResult: (id: string) => {
          ids.push(id);
          return Promise.resolve({
            calcProfile: "mapping",
            stats: { Sp: 5, MissFire: 4, MissCold: 0, Ehp: 500, Dps: 5000 },
          });
        },
      },
    } as never as PipelineContext;
    const d = stageAt(90);
    const tier = d.gear.tiers[0];
    if (tier === undefined) throw new Error("the fixture has a gear tier");
    tier.calcs = { mapping: { status: "ok", calcId: "geared" } } as never;
    const gates = await runGates(ctxSeen, d, cfg as never);
    expect(ids).toEqual(["geared"]);
    const g4 = gates.find((g) => g.gate === "G4")?.findings ?? [];
    expect(g4.find((f) => f.code === "resistance_below_cap")).toMatchObject({
      returnTo: "S7",
      path: "/gear/tiers/0/calcs",
    });
  });

  it("sends an endgame finding to the part of the last gear tier, also when its measurement is missing", async () => {
    const d = stageAt(90);
    const tier = d.gear.tiers[0];
    if (tier === undefined) throw new Error("the fixture has a gear tier");
    Object.assign(tier, { budgetTier: "mid", calcs: {} });
    const gates = await runGates(withStats(good), d, cfg as never);
    const g4 = gates.find((g) => g.gate === "G4")?.findings ?? [];
    expect(g4).toEqual([
      expect.objectContaining({ code: "stats_unavailable", returnTo: "S7.gear-mid" }),
    ]);
  });

  it("skips the resistance check for stage kinds that are not configured", async () => {
    expect(await run({ ...good, MissFire: 9 }, 90, {}, "campaign")).not.toContain(
      "G4:resistance_below_cap",
    );
  });

  it("treats a missing or foreign-profile result as unavailable", async () => {
    expect(await run(undefined)).toContain("G4:stats_unavailable");
    const foreign = await runGates(withStats(good, "pinnacle"), stageAt(90), cfg as never);
    expect(foreign.flatMap((g) => g.findings.map((f) => f.code))).toContain("stats_unavailable");
  });

  it("does not pass G4 or G5 without configured thresholds", async () => {
    const gates = await runGates(withStats(good), stageAt(90), { ...cfg, thresholds: [] } as never);
    for (const g of ["G4", "G5"]) {
      expect(gates.find((x) => x.gate === g)?.findings.map((f) => f.code)).toContain(
        "check_not_built",
      );
    }
  });

  it("does not pass G3 to G5 without the s10 config block", async () => {
    const gates = await runGates(ctx(), draft());
    for (const g of ["G3", "G4", "G5"]) {
      expect(gates.find((x) => x.gate === g)?.passed).toBe(false);
    }
  });
});

describe("S10 critic (G8)", () => {
  const verdict = (over: object = {}) => ({
    reviewed: [...CRITIC_SECTIONS],
    issues: [],
    ...over,
  });
  const g8 = async (v?: object) =>
    (await runGates(ctx(), draft(), undefined, v as never)).find((g) => g.gate === "G8");

  it("fails G8 until the critic has reviewed the guide", async () => {
    const gate = await g8(undefined);
    expect(gate?.passed).toBe(false);
    expect(gate?.findings.map((f) => f.code)).toEqual(["check_not_built"]);
  });

  it("passes G8 when every section was read and nothing was found", async () => {
    expect((await g8(verdict()))?.passed).toBe(true);
  });

  it("turns issues and unread sections into findings", async () => {
    const gate = await g8(
      verdict({
        reviewed: ["summary"],
        issues: [{ section: "faq", message: "Contradicts the gear plan" }],
      }),
    );
    expect(gate?.passed).toBe(false);
    const codes = gate?.findings.map((f) => f.code) ?? [];
    expect(codes).toContain("inconsistency");
    expect(codes).toContain("section_not_reviewed");
  });

  it("names the problem as text when the draft cannot be assembled", () => {
    const c = { run: { request: {} }, result: () => undefined } as never as PipelineContext;
    const out = criticTask(c, { promptVersion: "t" } as StageConfig, {
      chosen: {} as never,
      target: {} as never,
      mainSkillId: "G",
    });
    expect(typeof out).toBe("string");
  });
});

describe("S10 after the gates", () => {
  const f = (gate: string, code: string, returnTo?: string) => ({
    gate,
    severity: "error",
    code,
    message: "m",
    ...(returnTo === undefined ? {} : { returnTo }),
  });
  const report = (findings: object[]) => ({
    passed: false,
    gates: [{ gate: "G2", passed: false, findings }],
    critic: null,
  });
  const ctxWith = (results: Record<string, unknown>) =>
    ({ result: (k: string) => results[k] }) as never as PipelineContext;

  it("sends the earliest causing stage back with its findings", () => {
    const step = afterReport(
      ctxWith({
        "S10.report": report([f("G7", "a", "S8"), f("G2", "b", "S6"), f("G2", "c", "S6")]),
      }),
      2,
    );
    expect(step).toMatchObject({ kind: "return", stage: "S6", maxReturns: 2 });
    expect(step?.kind === "return" && step.findings.map((x) => x.code)).toEqual(["b", "c"]);
  });

  it("leaves a passed report to the publishing step", () => {
    const passed = {
      passed: true,
      gates: [{ gate: "G2", passed: true, findings: [] }],
      critic: null,
    };
    expect(afterReport(ctxWith({ "S10.report": passed }), 2)).toBeNull();
  });

  it("stops when no stage can fix what is open", () => {
    const step = afterReport(ctxWith({ "S10.report": report([f("G3", "check_not_built")]) }), 2);
    expect(step).toMatchObject({ kind: "blocked", error: { code: "validation_failed" } });
  });

  it("names an unreadable report", () => {
    expect(afterReport(ctxWith({ "S10.report": 5 }), 2)).toMatchObject({
      kind: "blocked",
      error: { code: "invalid_report" },
    });
  });

  it("recomputes a report that was made without the stored critic verdict", () => {
    const verdict = { reviewed: [...CRITIC_SECTIONS], issues: [] };
    expect(reportIsCurrent(ctxWith({}))).toBe(false);
    expect(reportIsCurrent(ctxWith({ "S10.report": report([]) }))).toBe(true);
    expect(reportIsCurrent(ctxWith({ "S10.report": report([]), "S10.critic": verdict }))).toBe(
      false,
    );
    expect(
      reportIsCurrent(
        ctxWith({ "S10.report": { ...report([]), critic: verdict }, "S10.critic": verdict }),
      ),
    ).toBe(true);
  });

  it("requires the critic to name every section it read", () => {
    expect(CriticVerdict.safeParse({ reviewed: ["summary"], issues: [] }).success).toBe(false);
  });

  it("rejects critic messages with digits and duplicate reviewed sections", () => {
    const base = { reviewed: [...CRITIC_SECTIONS], issues: [] };
    expect(CriticVerdict.safeParse(base).success).toBe(true);
    expect(
      CriticVerdict.safeParse({ ...base, reviewed: [...CRITIC_SECTIONS, "summary"] }).success,
    ).toBe(false);
    expect(
      CriticVerdict.safeParse({ ...base, issues: [{ section: "faq", message: "Needs 5 more" }] })
        .success,
    ).toBe(false);
  });
});
