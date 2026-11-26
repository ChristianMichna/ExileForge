import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RevalidationError } from "@astrolabe/revalidate";
import { loadReleaseForRevalidation, revalidateStoredGuide } from "../src/tools/revalidate.js";
import { guide, releaseId as RELEASE } from "./guide-fixture.js";

const NEXT = "poe2-9.8.8+r1";
const LATER = "poe2-9.8.8+r2";

function releaseDir(id: string, extra: object = {}, diff?: object): string {
  const dir = mkdtempSync(join(tmpdir(), "astrolabe-reval-"));
  const [, version, rev] = /^poe2-(.+)\+r(\d+)$/.exec(id) ?? [];
  const release = {
    id,
    gameVersion: version,
    pobVersion: "v9.9.9",
    pipelineRevision: Number(rev),
    sourceHashes: {},
    createdAt: "2026-01-01T00:00:00Z",
    ...extra,
  };
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, release, shards: [] }),
  );
  if (diff) writeFileSync(join(dir, "diff.json"), JSON.stringify(diff));
  return dir;
}
const diffOf = (kinds: object) => ({ schemaVersion: 1, from: RELEASE, to: NEXT, kinds });
const chained = { previousReleaseId: RELEASE, diffPath: "diff.json" };

describe("loadReleaseForRevalidation", () => {
  it("reads a release with its diff and refuses a diff between the wrong releases", async () => {
    const ok = await loadReleaseForRevalidation(releaseDir(NEXT, chained, diffOf({})));
    expect(ok.diff?.to).toBe(NEXT);
    const wrong = releaseDir(NEXT, chained, { ...diffOf({}), from: "poe2-1.0.0+r1" });
    await expect(loadReleaseForRevalidation(wrong)).rejects.toThrow(/goes from/);
  });
});

describe("broken release files", () => {
  it("fails loudly on a missing or invalid diff file and on a manifest outside the contract", async () => {
    await expect(loadReleaseForRevalidation(releaseDir(NEXT, chained))).rejects.toThrow(
      /Cannot read diff/,
    );
    const bad = releaseDir(NEXT, chained, { schemaVersion: 1, nope: true });
    await expect(loadReleaseForRevalidation(bad)).rejects.toThrow(/does not match the contract/);
    const dir = mkdtempSync(join(tmpdir(), "astrolabe-reval-"));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ schemaVersion: 1 }));
    await expect(loadReleaseForRevalidation(dir)).rejects.toThrow(/manifest/);
  });
  it("does not read the diff of the guide's own release", async () => {
    const own = releaseDir(RELEASE, {
      previousReleaseId: "poe2-9.8.6+r1",
      diffPath: "missing.json",
    });
    const dirs = [own, releaseDir(NEXT, chained, diffOf({}))];
    expect(
      (await revalidateStoredGuide({ guide, releaseDirs: dirs, now: () => new Date() })).verdict,
    ).toBe("unaffected");
  });
});

describe("revalidateStoredGuide", () => {
  const now = () => new Date("2026-11-26T05:00:00Z");
  it("refuses a guide that does not match the contract", async () => {
    await expect(
      revalidateStoredGuide({ guide: { metadata: {} }, releaseDirs: [], now }),
    ).rejects.toThrow(RevalidationError);
  });
  it("needs a newer release, and a diff on it", async () => {
    await expect(
      revalidateStoredGuide({ guide, releaseDirs: [releaseDir(RELEASE)], now }),
    ).rejects.toThrow(/at least/);
    await expect(
      revalidateStoredGuide({ guide, releaseDirs: [releaseDir(RELEASE), releaseDir(NEXT)], now }),
    ).rejects.toThrow(/no diff/);
  });
  it("finds a removed gem and a changed pob version over two releases", async () => {
    const dirs = [
      releaseDir(RELEASE),
      releaseDir(
        NEXT,
        chained,
        diffOf({ gem: { added: [], removed: ["Fixture/Gems/Support"], changed: [] } }),
      ),
      releaseDir(
        LATER,
        { previousReleaseId: NEXT, diffPath: "diff.json", pobVersion: "v10.0.0" },
        { schemaVersion: 1, from: NEXT, to: LATER, kinds: {} },
      ),
    ];
    const status = await revalidateStoredGuide({ guide, releaseDirs: dirs, now });
    expect(status.verdict).toBe("broken");
    expect(status.chain).toEqual([RELEASE, NEXT, LATER]);
    expect(status.factChanges).toEqual(["pobVersion"]);
    expect(status.findings.map((f) => f.ref.id)).toEqual(["Fixture/Gems/Support"]);
    expect(status.findings[0]?.stageIds).toEqual(["stage-1"]);
    expect(status.checkedAt).toBe("2026-11-26T05:00:00.000Z");
  });
  it("is unaffected when the diff touches nothing of the guide", async () => {
    const dirs = [
      releaseDir(RELEASE),
      releaseDir(NEXT, chained, diffOf({ mod: { added: ["other"], removed: [], changed: [] } })),
    ];
    expect((await revalidateStoredGuide({ guide, releaseDirs: dirs, now })).verdict).toBe(
      "unaffected",
    );
  });
});
