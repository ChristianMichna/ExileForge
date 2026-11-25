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
});
