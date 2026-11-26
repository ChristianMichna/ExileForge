import { describe, expect, it } from "vitest";
import { Health } from "../src/main/services.js";

describe("server health", () => {
  it("accepts the catalog-only mode with its reason", () => {
    const parsed = Health.parse({
      ok: true,
      calcEngine: "none",
      dataReleaseId: "poe2-1.0.0+r1",
      catalogOnly: true,
      catalogOnlyReason: "Catalog only: needs Path of Building v1.0.0",
    });
    expect(parsed.calcEngine).toBe("none");
    expect(parsed.catalogOnlyReason).toContain("Catalog only");
  });

  it("rejects a mismatch between engine and reason, and a very long reason", () => {
    expect(() => Health.parse({ calcEngine: "none", dataReleaseId: "x" })).toThrow();
    expect(() =>
      Health.parse({ calcEngine: "pob", dataReleaseId: "x", catalogOnlyReason: "r" }),
    ).toThrow();
    expect(() =>
      Health.parse({ calcEngine: "none", dataReleaseId: "x", catalogOnlyReason: "r".repeat(501) }),
    ).toThrow();
  });

  it("rejects an unknown engine", () => {
    expect(() => Health.parse({ calcEngine: "magic", dataReleaseId: "x" })).toThrow();
  });
});
