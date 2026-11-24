import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCatalogRelease } from "../src/catalog/memory-catalog.js";
import { RELEASE, writeFixtureRelease } from "./fixtures.js";

describe("catalog release loader", () => {
  it("loads a verified release and finds entries by id and name", async () => {
    const catalog = await loadCatalogRelease(writeFixtureRelease());
    expect(catalog.dataReleaseId).toBe(RELEASE);
    expect(catalog.get({ kind: "gem", id: "FixGemMain" })?.name).toBe("Fixture FixGemMain");
    expect(catalog.get({ kind: "mod", id: "FixGemMain" })).toBeUndefined();
    expect(catalog.search({ text: "ascendancy b1", limit: 5 }).map((e) => e.id)).toEqual([
      "FixAscB1",
    ]);
    expect(catalog.search({ text: "fixture", kind: "gem", limit: 2 })).toHaveLength(2);
  });

  it("refuses a shard whose hash does not match the manifest", async () => {
    const dir = writeFixtureRelease();
    appendFileSync(join(dir, "gem.json"), " ");
    await expect(loadCatalogRelease(dir)).rejects.toThrow(/sha256 mismatch/);
  });
});
