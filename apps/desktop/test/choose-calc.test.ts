import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseCalc, type PobLocation } from "../src/main/services.js";

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

async function location(required: boolean): Promise<PobLocation> {
  const base = await mkdtemp(join(tmpdir(), "ef-pob-"));
  return {
    resourcesRoot: base,
    pobHome: join(base, "pob"),
    workerLua: join(base, "worker.lua"),
    optimizerConfigPath: join(base, "tree.json"),
    required,
  };
}

describe("calc engine choice", () => {
  it("runs on calc-fake when nothing asks for PoB", async () => {
    expect(await chooseCalc(undefined, "/none", logger)).toBe("fake");
  });

  it("runs on calc-fake in development when PoB is not installed", async () => {
    expect(await chooseCalc(await location(false), "/none", logger)).toBe("fake");
  });

  it("fails for an installed app without PoB instead of showing invented numbers", async () => {
    await expect(chooseCalc(await location(true), "/none", logger)).rejects.toThrow(
      /Path of Building is missing/,
    );
  });
});
