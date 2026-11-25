import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BuildRequest } from "@astrolabe/contracts/build";
import { CatalogShard, type CatalogManifest } from "@astrolabe/contracts/catalog";
import { DataReleaseId, type JsonValue } from "@astrolabe/contracts/common";
import { MemoryCatalog } from "../src/catalog/memory-catalog.js";
import type { ForgeConfig } from "../src/config/forge-config.js";

/*
 * Fantasy catalog for tests: no real game entities (CLAUDE.md: no game
 * knowledge from memory). Ids and names are invented and say so.
 */
export const RELEASE = DataReleaseId.parse("poe2-9.8.7+r1");

const raw = [
  {
    kind: "characterClass",
    entities: [
      {
        id: "FixClassA",
        name: "Fixture Class A",
        baseAttributes: {},
        startNodeId: "FixStartA",
        ascendancyIds: ["FixAscA1"],
      },
      {
        id: "FixClassB",
        name: "Fixture Class B",
        baseAttributes: {},
        startNodeId: "FixStartB",
        ascendancyIds: ["FixAscB1"],
      },
      {
        id: "FixClassC",
        name: "Fixture Class C",
        baseAttributes: {},
        startNodeId: "FixStartC",
        ascendancyIds: ["FixAscC1"],
      },
    ],
  },
  {
    kind: "ascendancy",
    entities: [
      { id: "FixAscA1", name: "Fixture Ascendancy A1", classId: "FixClassA", nodeIds: [] },
      { id: "FixAscB1", name: "Fixture Ascendancy B1", classId: "FixClassB", nodeIds: [] },
      { id: "FixAscC1", name: "Fixture Ascendancy C1", classId: "FixClassC", nodeIds: [] },
    ],
  },
  {
    kind: "gem",
    entities: ["FixGemMain", "FixGemSupport", "FixGemOther"].map((id) => ({
      id,
      name: `Fixture ${id}`,
      kind: "fixture_kind",
      tags: [],
      levels: [{ level: 1, requirements: { attributes: {} }, stats: {} }],
    })),
  },
];

export const SHARDS = raw.map((s) =>
  CatalogShard.parse({ schemaVersion: 1, dataReleaseId: RELEASE, ...s }),
);

export function fixtureCatalog(): MemoryCatalog {
  return new MemoryCatalog(RELEASE, SHARDS);
}

/** Writes the fixture release to a temp dir as manifest.json + shards. */
export function writeFixtureRelease(): string {
  const dir = mkdtempSync(join(tmpdir(), "astrolabe-release-"));
  const shards = raw.map((s) => {
    const text = JSON.stringify({ schemaVersion: 1, dataReleaseId: RELEASE, ...s });
    const path = `${s.kind}.json`;
    writeFileSync(join(dir, path), text);
    return {
      kind: s.kind,
      path,
      sha256: createHash("sha256").update(text).digest("hex"),
      count: s.entities.length,
    };
  });
  const manifest = {
    schemaVersion: 1,
    release: {
      id: RELEASE,
      gameVersion: "9.8.7",
      pobVersion: "v9.9.9",
      pipelineRevision: 1,
      sourceHashes: {},
      createdAt: "2026-01-01T00:00:00Z",
    },
    shards,
  } satisfies Record<keyof CatalogManifest, unknown>;
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  return dir;
}

export const CONFIG: ForgeConfig = {
  version: "test",
  sessionCodeTtlMinutes: 30,
  maxAttemptsPerTask: 3,
  waitLongPollSeconds: 0,
  waitRetryAfterSeconds: 5,
  attachFailuresPerMinute: 3,
  pipelines: {
    poc: {
      candidateCount: 2,
      skeletonLevel: 1,
      skeletonGemLevel: 1,
      calcProfiles: ["default"],
      promptVersion: "test",
    },
  },
};

export const REQUEST = BuildRequest.parse({
  dataReleaseId: RELEASE,
  skillIdea: "fixture idea",
  mainSkillId: "FixGemMain",
  mode: { hardcore: false, ssf: false },
  budget: { leveling: "low", endgame: "mid" },
  preferences: { focus: "allround", pace: "balanced", complexityTolerance: "medium" },
});

const text = (t: string): JsonValue => [{ type: "text", text: t }];

/** A valid S2 candidate payload for the fixture catalog. */
export function candidate(
  key: string,
  classId: string,
  ascendancyId: string,
): Record<string, JsonValue> {
  return {
    key,
    title: `Candidate ${key}`,
    classId,
    ascendancyId,
    damageRoute: text("route"),
    defenceConcept: text("defence"),
    keyEntities: [{ kind: "gem", id: "FixGemMain" }],
    hypothesis: text("works because of the route"),
  };
}

export function gemSetup(mainGem = "FixGemMain"): Record<string, JsonValue> {
  return {
    skills: [
      {
        key: "main",
        role: "main",
        gem: { gemId: mainGem, level: 1 },
        supports: [{ gemId: "FixGemSupport", level: 1 }],
      },
    ],
    rationale: [{ reason: text("support fits the main skill") }],
  };
}
