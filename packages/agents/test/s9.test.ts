import { describe, expect, it } from "vitest";
import type { TargetBuild } from "@astrolabe/contracts/build";
import type { PipelineContext } from "../src/pipeline.js";
import type { StageConfig } from "../src/config.js";
import {
  S9_SECTIONS,
  citableCalcs,
  sectionTask,
  sectionKey,
  sectionSchemas,
  walkSection,
} from "../src/stages/s9-guide.js";

const text = (t: string) => ({ type: "text" as const, text: t });
const entity = (id: string) => ({
  type: "entity" as const,
  ref: { kind: "gem" as const, id },
});

describe("S9 sections", () => {
  it("has one task type per section that matches the task type pattern", () => {
    for (const s of S9_SECTIONS) {
      expect(sectionKey(s)).toMatch(/^S9\.[a-z][a-z0-9-]*$/);
      expect(sectionSchemas[s]).toBeDefined();
    }
  });

  it("finds rich text and catalog references with JSON pointers", () => {
    const out = walkSection({
      variants: [
        {
          kind: "alternative",
          replaces: { kind: "gem", id: "FixA" },
          with: [{ kind: "gem", id: "FixB" }],
          explanation: [text("Swap"), entity("FixC")],
        },
      ],
    });
    expect(out.texts.map((t) => t.path)).toEqual(["/variants/0/explanation"]);
    expect(out.entities.map((e) => [e.path, e.ref.id])).toEqual([
      ["/variants/0/replaces", "FixA"],
      ["/variants/0/with/0", "FixB"],
      ["/variants/0/explanation/1/ref", "FixC"],
    ]);
  });

  it("treats the mod ids of the atlas section as catalog mods", () => {
    const out = walkSection({
      strategy: [text("Go")],
      avoidMods: [{ modId: "FixMod", reason: [text("Bad")] }],
    });
    expect(out.entities).toEqual([
      { path: "/avoidMods/0/modId", ref: { kind: "mod", id: "FixMod" } },
    ]);
    expect(out.texts.map((t) => t.path)).toEqual(["/strategy", "/avoidMods/0/reason"]);
  });

  it("offers only successful calculations of the target for citation", () => {
    const target = {
      calcs: {
        a: { status: "ok", calcId: "calc-1" },
        b: { status: "failed", error: { code: "x", message: "y" } },
      },
    } as unknown as TargetBuild;
    expect(citableCalcs(target)).toEqual([{ profile: "a", calcId: "calc-1" }]);
  });
});

describe("S9 summary check", () => {
  const run = async (mode: object, suitability: object) => {
    const ctx = {
      run: { request: { mode }, interventions: [] },
      result: () => undefined,
    } as never as PipelineContext;
    const spec = sectionTask(ctx, { promptVersion: "t" } as StageConfig, "summary", {
      chosen: {} as never,
      target: { calcs: {} } as never,
      plans: { progression: null, gear: null, crafting: null },
    }) as never as { check: (p: unknown, c: PipelineContext) => Promise<{ code: string }[]> };
    return (await spec.check({ suitability }, ctx)).map((f) => f.code);
  };

  it("accepts a suitability that covers the requested mode", async () => {
    expect(
      await run({ ssf: true, hardcore: false }, { softcore: true, hardcore: false, ssf: true }),
    ).toEqual([]);
  });

  it("rejects a suitability that contradicts the request", async () => {
    expect(
      await run({ ssf: true, hardcore: true }, { softcore: true, hardcore: false, ssf: false }),
    ).toEqual(["suitability_contradicts_request", "suitability_contradicts_request"]);
  });

  it("fails loudly when an earlier section is missing", () => {
    const ctx = { run: { request: {} }, result: () => undefined } as never as PipelineContext;
    expect(() =>
      sectionTask(ctx, { promptVersion: "t" } as StageConfig, "faq", {
        chosen: {} as never,
        target: { calcs: {} } as never,
        plans: { progression: null, gear: null, crafting: null },
      }),
    ).toThrow(/missing/);
  });

  it("finds subjects of boss mechanics and entities in lists of rich text", () => {
    const out = walkSection({
      bossMechanics: [{ subject: { kind: "gem", id: "FixA" }, advice: [text("Dodge")] }],
      strengths: [[text("Fast"), entity("FixB")]],
    });
    expect(out.entities.map((e) => e.path)).toEqual([
      "/bossMechanics/0/subject",
      "/strengths/0/1/ref",
    ]);
  });
});
