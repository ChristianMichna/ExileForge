import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  decide,
  exitCodeFor,
  readPinnedCommit,
  renderReport,
  watchConfigSchema,
} from "../src/watch/watch.ts";
import { latestPobRelease, listDataGameVersions } from "../src/watch/github.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const PATTERN = 'POB_REF="\\$\\{POB_REF:-([0-9a-f]{40})\\}"';

describe("the real configuration", () => {
  it("finds exactly one pinned commit in the real pin file", () => {
    const root = new URL("../../..", import.meta.url);
    const config = watchConfigSchema.parse(
      JSON.parse(readFileSync(new URL("config/data-pipeline/watch.json", root), "utf8")),
    );
    const pin = readFileSync(new URL(config.pinFile, root), "utf8");
    expect(readPinnedCommit(pin, config.pinPattern)).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("exit code", () => {
  it("is 3 when there is something to do and 0 otherwise", () => {
    const quiet = decide({
      gamePatch: "1",
      dataGameVersions: ["1"],
      pob: { pinnedSha: SHA_A, latestTag: "v1.0.0", latestSha: SHA_A },
    });
    expect(exitCodeFor(quiet)).toBe(0);
    expect(
      exitCodeFor({
        ...quiet,
        findings: decide({
          gamePatch: "2",
          dataGameVersions: ["1"],
          pob: { pinnedSha: SHA_A, latestTag: "v1.0.0", latestSha: SHA_A },
        }).findings,
      }),
    ).toBe(3);
  });
});

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
    expect(report.needsPobCheck).toBe(false);
    expect(renderReport(report)).toContain("Up to date");
  });
  it("calls a new game patch without a new PoB catalog-only", () => {
    const report = decide({
      ...base,
      pob: { pinnedSha: SHA_A, latestTag: "v1", latestSha: SHA_A },
    });
    expect(report.findings.map((f) => f.kind)).toEqual(["new-game-patch"]);
    expect(report.needsPobCheck).toBe(true);
    expect(renderReport(report)).toContain("Catalog-only");
    // a pin raised earlier must not make the report contradict itself: it asks, it does not claim
    expect(report.findings[0]?.steps.join(" ")).toContain("do they cover game patch 1.0.0.1");
  });
  it("asks for the PoB bump first when both are new", () => {
    const report = decide({
      ...base,
      pob: { pinnedSha: SHA_A, latestTag: "v2", latestSha: SHA_B },
    });
    expect(report.findings.map((f) => f.kind)).toEqual(["new-pob-release", "new-game-patch"]);
    expect(report.needsPobCheck).toBe(false);
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
  const rel = (tag: string, extra: object = {}) => ({
    tag_name: tag,
    draft: false,
    published_at: "2026-01-01T00:00:00Z",
    assets: [
      { name: `catalog-${tag.slice(5)}.tar.gz` },
      { name: `catalog-${tag.slice(5)}.tar.gz.sha256` },
    ],
    ...extra,
  });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  it("lists game versions of data releases only", async () => {
    const versions = await listDataGameVersions(
      async () =>
        json([
          rel("data-poe2-0.5.5.10-r12"),
          rel("data-poe2-0.5.5.10-r11"),
          rel("data-poe2-1.0.0-r1", { draft: true }),
          rel("data-poe2-1.1.0-r1", { assets: [] }),
          rel("data-poe2-1.2.0-r1", { published_at: null }),
          rel("v0.1.0"),
        ]),
      "o/r",
      5,
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
    await expect(latestPobRelease(async () => json({}, 403), "p/b", 5)).rejects.toThrow(/403/);
    await expect(
      latestPobRelease(async () => json({ tag_name: "@everyone" }), "p/b", 5),
    ).rejects.toThrow();
    await expect(
      latestPobRelease(
        async () => {
          throw new Error("offline");
        },
        "p/b",
        5,
      ),
    ).rejects.toThrow(/Could not reach/);
  });
});
