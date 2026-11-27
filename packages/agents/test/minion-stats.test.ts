import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { StageConfig } from "../src/config.js";
import {
  isMinionSkill,
  minionMetricFloors,
  minionStatName,
  minionWeights,
  withMinionStats,
} from "../src/minion-stats.js";

const minion = {
  skillKinds: ["Minion"],
  statMap: { FullDPS: "MinionCombinedDPS", CombinedDPS: "MinionCombinedDPS" },
};
const catalogWith = (kind: string) =>
  ({
    get: (ref: { kind: string; id: string }) =>
      ref.id === "gem-a" ? { ref, entity: { kind, tags: ["minion"] } } : undefined,
  }) as never;

describe("minion stats", () => {
  it("recognises a minion skill by its gem kind (not by the tag some damage skills carry too), and never without the setting or the gem", () => {
    expect(isMinionSkill(catalogWith("Minion"), "gem-a", minion)).toBe(true);
    expect(isMinionSkill(catalogWith("Spell"), "gem-a", minion)).toBe(false);
    expect(isMinionSkill(catalogWith("Minion"), "gem-a", undefined)).toBe(false);
    expect(isMinionSkill(catalogWith("Minion"), "unknown", minion)).toBe(false);
  });

  it("replaces mapped stat names and leaves the others", () => {
    expect(minionStatName(minion, "FullDPS")).toBe("MinionCombinedDPS");
    expect(minionStatName(minion, "TotalEHP")).toBe("TotalEHP");
    expect(minionWeights(minion, { FullDPS: 1, TotalEHP: 0.4 })).toEqual({
      MinionCombinedDPS: 1,
      TotalEHP: 0.4,
    });
  });

  it("refuses two weights that would land on one stat", () => {
    expect(() => minionWeights(minion, { FullDPS: 1, CombinedDPS: 2 })).toThrow(
      /two objective weights/,
    );
  });

  it("maps both sides of a metric floor and refuses a clash", () => {
    expect(minionMetricFloors(minion, { FullDPS: "Other", Int: "ReqInt" })).toEqual({
      MinionCombinedDPS: "Other",
      Int: "ReqInt",
    });
    expect(() => minionMetricFloors(minion, { FullDPS: "A", CombinedDPS: "B" })).toThrow(
      /two metric floors/,
    );
  });

  it("changes the gear objective and the damage gate of the shipped config", () => {
    const config = StageConfig.parse(
      JSON.parse(
        readFileSync(new URL("../../../config/agents/stages.json", import.meta.url), "utf8"),
      ),
    );
    expect(config.minion).toBeDefined();
    const out = withMinionStats(config, config.minion ?? minion);
    expect(out.s10?.stats.dps).toBe(config.minion?.statMap[config.s10?.stats.dps ?? ""]);
    expect(Object.keys(out.s7?.objective.weights ?? {})).toContain("MinionCombinedDPS");
    expect(Object.keys(out.s7?.objective.weights ?? {})).not.toContain("FullDPS");
    // the original is not changed
    expect(config.s10?.stats.dps).toBe("CombinedDPS");
  });
});
