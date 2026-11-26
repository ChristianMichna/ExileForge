import { describe, expect, it } from "vitest";
import type { DataRelease } from "@astrolabe/contracts/catalog";
import { CalcFake } from "../src/calc/calc-fake.js";
import { ForgeEngine } from "../src/engine/forge-engine.js";
import { buildFileResolvers } from "../src/export/build-file-resolvers.js";
import { createApp } from "../src/http/app.js";
import { createMemoryLogger } from "../src/logger.js";
import { createPocPipeline } from "../src/pipelines/poc-pipeline.js";
import type { CatalogPort } from "../src/ports/catalog.js";
import { RunStore } from "../src/store/run-store.js";
import { guide } from "./guide-fixture.js";
import { CONFIG, RELEASE, fixtureCatalog } from "./fixtures.js";

const TOKEN = "c".repeat(64);
const headers = { host: "127.0.0.1:1", authorization: `Bearer ${TOKEN}` };
const GUIDE_ID = guide.metadata.guideId;
const validation = { gates: [], completenessScore: 100, scoringConfigVersion: "1", passed: true };
const validated = { ...guide, validation };
const stored = { ...validated, metadata: { ...guide.metadata, dataReleaseId: RELEASE } };

function app(findGuide: ((id: string) => unknown) | undefined) {
  const store = new RunStore(":memory:");
  const catalog = fixtureCatalog();
  const calc = new CalcFake({ dataReleaseId: RELEASE });
  return createApp({
    engine: new ForgeEngine({
      store,
      catalog,
      calc,
      config: CONFIG,
      pipelines: [createPocPipeline(CONFIG.pipelines.poc)],
      calcProfiles: ["default"],
    }),
    catalog,
    calc,
    calcProfiles: ["default"],
    waitLongPollSeconds: 0,
    logger: createMemoryLogger(),
    port: 1,
    allowedOrigins: [],
    defaultPipelineId: "poc",
    accessToken: TOKEN,
    ...(findGuide === undefined ? {} : { findGuide }),
  });
}

describe("GET /api/guides/:guideId/build-file", () => {
  it("needs the access token", async () => {
    const res = await app(() => stored).inject({
      method: "GET",
      url: `/api/guides/${GUIDE_ID}/build-file`,
      headers: { host: headers.host },
    });
    expect(res.statusCode).toBe(401);
  });

  it("exports the stored guide and lists what the release has no id for", async () => {
    const res = await app(() => stored).inject({
      method: "GET",
      url: `/api/guides/${GUIDE_ID}/build-file`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ file: { name: string; passives: unknown[] }; omitted: string[] }>();
    expect(body.file.passives).toEqual([]);
    expect(body.omitted).toContain("passive fixture_node_1: the release has no game id");
    expect(body.file.name.length).toBeGreaterThan(0);
  });

  it("answers 404 for an unknown guide", async () => {
    const res = await app(() => undefined).inject({
      method: "GET",
      url: `/api/guides/${GUIDE_ID}/build-file`,
      headers,
    });
    expect(res.statusCode).toBe(404);
  });

  it("refuses a guide built with another release", async () => {
    const res = await app(() => validated).inject({
      method: "GET",
      url: `/api/guides/${GUIDE_ID}/build-file`,
      headers,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(/revalidate/);
  });

  it("refuses a stored value that is not a guide", async () => {
    const res = await app(() => ({ nope: true })).inject({
      method: "GET",
      url: `/api/guides/${GUIDE_ID}/build-file`,
      headers,
    });
    expect(res.statusCode).toBe(400);
  });

  it("is a bad request without a run store", async () => {
    const res = await app(undefined).inject({
      method: "GET",
      url: `/api/guides/${GUIDE_ID}/build-file`,
      headers,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("buildFileResolvers", () => {
  const entries: Record<string, { name?: string; entity: unknown }> = {
    "passiveNode:n1": { entity: { gameId: "game_n1" } },
    "passiveNode:n2": { entity: {} },
    "uniqueItem:u1": { name: "Unique One", entity: {} },
    "ascendancy:Asc1": { name: "Fixture Asc", entity: {} },
    "mod:m1": { name: "Mod One", entity: {} },
  };
  const catalog = {
    dataReleaseId: RELEASE,
    release: {
      itemSlots: {
        slots: [{ id: "Helmet", gameId: "Helm1" }, { id: "Flask 1" }],
      },
      rarities: { rarities: [{ id: "rare", name: "Rare" }] },
    } as unknown as DataRelease,
    get: (ref: { kind: string; id: string }) => {
      const e = entries[`${ref.kind}:${ref.id}`];
      return e === undefined ? undefined : { kind: ref.kind, id: ref.id, ...e };
    },
  } as unknown as CatalogPort;
  const r = buildFileResolvers(catalog);

  it("reads game ids and names from the release and leaves the rest undefined", () => {
    expect(r.passiveGameId("n1")).toBe("game_n1");
    expect(r.passiveGameId("n2")).toBeUndefined();
    expect(r.passiveGameId("nope")).toBeUndefined();
    expect(r.slotGameId("Helmet")).toBe("Helm1");
    expect(r.slotGameId("Flask 1")).toBeUndefined();
    expect(r.slotGameId("Nope")).toBeUndefined();
    expect(r.uniqueName("u1")).toBe("Unique One");
    expect(r.ascendancyName("Asc1")).toBe("Asc1");
    expect(r.ascendancyName("Asc2")).toBeUndefined();
    expect(r.rarityName("rare")).toBe("Rare");
    expect(r.rarityName("magic")).toBeUndefined();
    expect(r.entityName({ kind: "mod", id: "m1" })).toBe("Mod One");
  });

  it("works for a release without slot or rarity facts", () => {
    const bare = buildFileResolvers({ ...catalog, release: undefined } as CatalogPort);
    expect(bare.slotGameId("Helmet")).toBeUndefined();
    expect(bare.rarityName("rare")).toBeUndefined();
  });
});
