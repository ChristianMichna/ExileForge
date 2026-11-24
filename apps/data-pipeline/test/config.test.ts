import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPobSources, pobSourcesSchema } from "../src/config.ts";

const REPO_CONFIG = fileURLToPath(
  new URL("../../../config/data-pipeline/pob-sources.json", import.meta.url),
);

describe("pob-sources config", () => {
  it("the committed config is valid", async () => {
    const cfg = await loadPobSources(REPO_CONFIG);
    expect(cfg.kinds.length).toBeGreaterThan(0);
  });

  it("rejects paths that leave PoB's src directory", () => {
    const res = pobSourcesSchema.safeParse({
      kinds: [{ kind: "x", sources: [{ loader: "return", file: "../evil.lua" }] }],
    });
    expect(res.success).toBe(false);
  });

  it("rejects duplicate kinds", () => {
    const k = { kind: "x", sources: [{ loader: "uniqueDB" }] };
    expect(pobSourcesSchema.safeParse({ kinds: [k, k] }).success).toBe(false);
  });

  it("rejects unknown loaders and fields", () => {
    expect(
      pobSourcesSchema.safeParse({ kinds: [{ kind: "x", sources: [{ loader: "eval" }] }] }).success,
    ).toBe(false);
    expect(
      pobSourcesSchema.safeParse({
        kinds: [{ kind: "x", sources: [{ loader: "uniqueDB", extra: 1 }] }],
      }).success,
    ).toBe(false);
  });

  it("names the file when the config is broken", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ef-cfg-"));
    const path = join(dir, "bad.json");
    await writeFile(path, "{ not json");
    await expect(loadPobSources(path)).rejects.toThrow(path);
  });
});
