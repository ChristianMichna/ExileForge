import { describe, expect, it } from "vitest";
import type { TargetBuild } from "@astrolabe/contracts/build";
import {
  S9_SECTIONS,
  citableCalcs,
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
