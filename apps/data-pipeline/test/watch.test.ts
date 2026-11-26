import { describe, expect, it } from "vitest";
import { decide, readPinnedCommit, renderReport } from "../src/watch/watch.ts";
import { latestPobRelease, listDataGameVersions } from "../src/watch/github.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const PATTERN = 'POB_REF="\\$\\{POB_REF:-([0-9a-f]{40})\\}"';

describe("readPinnedCommit", () => {
  it("reads the pinned commit and refuses ambiguous or missing pins", () => {
    expect(readPinnedCommit(`POB_REF="\${POB_REF:-${SHA_A}}"   # v1`, PATTERN)).toBe(SHA_A);
    expect(() => readPinnedCommit("nothing", PATTERN)).toThrow(/0 matches/);
    const twice = `POB_REF="\${POB_REF:-${SHA_A}}"\nPOB_REF="\${POB_REF:-${SHA_B}}"`;
    expect(() => readPinnedCommit(twice, PATTERN)).toThrow(/2 matches/);
  });
});

describe("decide", () => {
  const base = { gamePatch: "1.0.0.1", dataGameVersions: ["0.5.5.10"] };
  it("is quiet when the patch has a data release and the pin is current", () => {
    const report = decide({
      gamePatch: "0.5.5.10",
      dataGameVersions: ["0.5.5.10"],
      pob: { pinnedSha: SHA_A, latestTag: "v1", latestSha: SHA_A },
    });
    expect(report.findings).toEqual([]);
    expect(report.catalogOnlyUntilPob).toBe(false);
    expect(renderReport(report)).toContain("Up to date");
  });
  it("calls a new game patch without a new PoB catalog-only", () => {
    const report = decide({
      ...base,
      pob: { pinnedSha: SHA_A, latestTag: "v1", latestSha: SHA_A },
    });
    expect(report.findings.map((f) => f.kind)).toEqual(["new-game-patch"]);
    expect(report.catalogOnlyUntilPob).toBe(true);
    expect(renderReport(report)).toContain("Catalog-only");
  });
  it("asks for the PoB bump first when both are new", () => {
    const report = decide({
      ...base,
      pob: { pinnedSha: SHA_A, latestTag: "v2", latestSha: SHA_B },
    });
    expect(report.findings.map((f) => f.kind)).toEqual(["new-pob-release", "new-game-patch"]);
    expect(report.catalogOnlyUntilPob).toBe(false);
    expect(report.findings[0]?.steps.join(" ")).toContain(SHA_B);
    expect(report.findings[0]?.steps.join(" ")).toContain("game-version 1.0.0.1");
  });
  it("reports a PoB release within the same patch", () => {
    const report = decide({
      gamePatch: "0.5.5.10",
      dataGameVersions: ["0.5.5.10"],
      pob: { pinnedSha: SHA_A, latestTag: "v2", latestSha: SHA_B },
    });
    expect(report.findings.map((f) => f.kind)).toEqual(["new-pob-release"]);
    expect(report.findings[0]?.steps.join(" ")).toContain("next revision");
  });
});

describe("GitHub readers", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  it("lists game versions of data releases only", async () => {
    const versions = await listDataGameVersions(
      async () =>
        json([
          { tag_name: "data-poe2-0.5.5.10-r12", draft: false },
          { tag_name: "data-poe2-0.5.5.10-r11", draft: false },
          { tag_name: "data-poe2-1.0.0-r1", draft: true },
          { tag_name: "v0.1.0", draft: false },
        ]),
      "o/r",
    );
    expect(versions).toEqual(["0.5.5.10"]);
  });
  it("resolves the latest PoB release to a commit and fails loudly otherwise", async () => {
    const urls: string[] = [];
    const found = await latestPobRelease(async (url) => {
      urls.push(url);
      return url.endsWith("/releases/latest")
        ? json({ tag_name: "v0.24.0" })
        : json({ sha: SHA_B });
    }, "p/b");
    expect(found).toEqual({ tag: "v0.24.0", sha: SHA_B });
    expect(urls[1]).toContain("/commits/v0.24.0");
    await expect(latestPobRelease(async () => json({}, 403), "p/b")).rejects.toThrow(/403/);
  });
});
