import { describe, expect, it } from "vitest";
import { BuildState } from "@exileforge/contracts/build";
import { ClassBaseBuilds } from "../src/calc/base-builds.js";

const state = BuildState.parse({
  classId: "FixClassA",
  level: 40,
  tree: { allocated: [] },
  skills: [],
  items: [],
});

describe("ClassBaseBuilds", () => {
  it("returns a level-1 empty state of the class with PoB's payload, exported once per class", async () => {
    let exports = 0;
    const bases = new ClassBaseBuilds({
      baseBuild: () => {
        exports += 1;
        return Promise.resolve({ format: "xml" as const, payload: "<PathOfBuilding/>" });
      },
    });
    const a = await bases.baseFor(state);
    await bases.baseFor(state);
    expect(exports).toBe(1);
    expect(a).toMatchObject({
      format: "xml",
      payload: "<PathOfBuilding/>",
      state: { classId: "FixClassA", level: 1, tree: { allocated: [] }, skills: [], items: [] },
    });
  });

  it("does not cache a failed export", async () => {
    let calls = 0;
    const bases = new ClassBaseBuilds({
      baseBuild: () =>
        ++calls === 1
          ? Promise.reject(new Error("pob down"))
          : Promise.resolve({ format: "xml" as const, payload: "<x/>" }),
    });
    await expect(bases.baseFor(state)).rejects.toThrow("pob down");
    await expect(bases.baseFor(state)).resolves.toMatchObject({ payload: "<x/>" });
  });
});
