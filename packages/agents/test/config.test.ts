import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { StageConfig } from "../src/config.js";

describe("config/agents/stages.json", () => {
  it("matches the StageConfig schema", () => {
    const raw: unknown = JSON.parse(
      readFileSync(new URL("../../../config/agents/stages.json", import.meta.url), "utf8"),
    );
    expect(StageConfig.safeParse(raw).success).toBe(true);
  });

  it("rejects gates that read another calc profile than the gear is measured with", () => {
    const raw = JSON.parse(
      readFileSync(new URL("../../../config/agents/stages.json", import.meta.url), "utf8"),
    ) as { s10: { calcProfile: string } };
    raw.s10.calcProfile = "pinnacle";
    expect(StageConfig.safeParse(raw).success).toBe(false);
  });

  it("rejects required gate profiles that S6 does not calculate", () => {
    const raw = JSON.parse(
      readFileSync(new URL("../../../config/agents/stages.json", import.meta.url), "utf8"),
    ) as { s10: { requiredCalcProfiles: string[] } };
    raw.s10.requiredCalcProfiles = ["not-calculated"];
    expect(StageConfig.safeParse(raw).success).toBe(false);
  });

  it("needs a respec gain for at least one stage kind, and none for a kind means no respec", () => {
    const raw = JSON.parse(
      readFileSync(new URL("../../../config/agents/stages.json", import.meta.url), "utf8"),
    ) as { s6: { respec: { minGainRatio: object } } };
    raw.s6.respec.minGainRatio = {};
    expect(StageConfig.safeParse(raw).success).toBe(false);
    raw.s6.respec.minGainRatio = { endgame: 1 };
    expect(StageConfig.safeParse(raw).success).toBe(true);
  });
});
