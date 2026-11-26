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

function app(
  findGuide: ((id: string) => unknown) | undefined,
  catalogOverride?: CatalogPort,
  listGuideIds?: () => string[],
) {
  const store = new RunStore(":memory:");
  const catalog = catalogOverride ?? fixtureCatalog();
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
    ...(listGuideIds === undefined ? {} : { listGuideIds }),
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

  it("writes the game ids the release carries", async () => {
    const base = fixtureCatalog();
    const catalog: CatalogPort = {
      dataReleaseId: base.dataReleaseId,
      release: base.release,
      get: (ref) =>
        ref.kind === "passiveNode" && ref.id === "fixture_node_1"
          ? { kind: "passiveNode", id: ref.id, entity: { gameId: "game_node_1" } }
          : base.get(ref),
      search: (q) => base.search(q),
      list: (k) => base.list(k),
      hasStat: (id) => base.hasStat(id),
    };
    const res = await app(() => stored, catalog).inject({
      method: "GET",
      url: `/api/guides/${GUIDE_ID}/build-file`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ file: { passives: { id: string }[] }; omitted: string[] }>();
    expect(body.file.passives.map((p) => p.id)).toEqual(["game_node_1"]);
    expect(body.omitted).not.toContain("passive fixture_node_1: the release has no game id");
  });

  it("explains a guide whose stages are out of level order instead of answering 500", async () => {
    const first = stored.progression.stages[0];
    const empty = {
      ...stored,
      progression: {
        stages: [
          { ...first, levelRange: [20, 30] },
          { ...first, key: "stage-2", order: 1, levelRange: [1, 10] },
        ],
      },
    };
    const res = await app(() => empty).inject({
      method: "GET",
      url: `/api/guides/${GUIDE_ID}/build-file`,
      headers,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(/cannot be exported/);
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

describe("guide routes", () => {
  const get = (url: string, a: ReturnType<typeof app>) => a.inject({ method: "GET", url, headers });

  it("serves a stored guide and refuses an unknown or damaged one", async () => {
    const a = app((id) => (id === GUIDE_ID ? stored : id === "bad" ? { nope: 1 } : undefined));
    const ok = await get(`/api/guides/${GUIDE_ID}`, a);
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ metadata: { guideId: string } }>().metadata.guideId).toBe(GUIDE_ID);
    expect((await get("/api/guides/unknown", a)).statusCode).toBe(404);
    expect((await get("/api/guides/bad", a)).statusCode).toBe(400);
  });

  it("lists guides with names and says which ones it cannot read", async () => {
    const a = app(
      (id) => (id === GUIDE_ID ? stored : { nope: 1 }),
      undefined,
      () => [GUIDE_ID, "bad"],
    );
    const res = await get("/api/guides", a);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ guides: Record<string, unknown>[] }>();
    expect(body.guides[0]).toMatchObject({
      guideId: GUIDE_ID,
      dataReleaseId: RELEASE,
      ascendancyId: "fixture_asc",
      current: true,
    });
    expect(body.guides[1]).toEqual({ guideId: "bad", error: "The stored guide cannot be read." });
  });

  it("keeps listing when reading one stored guide throws, and omits unknown names", async () => {
    const a = app(
      (id) => {
        if (id === "broken") throw new Error("damaged run record");
        return stored;
      },
      undefined,
      () => ["broken", GUIDE_ID],
    );
    const body = (await get("/api/guides", a)).json<{ guides: Record<string, unknown>[] }>();
    expect(body.guides[0]).toEqual({
      guideId: "broken",
      error: "The stored guide cannot be read.",
    });
    expect(body.guides[1]).toMatchObject({ guideId: GUIDE_ID });
    // The fixture catalog knows neither the guide's main skill nor its ascendancy by name.
    expect(Object.keys(body.guides[1] ?? {})).not.toContain("mainSkillName");
    expect(Object.keys(body.guides[1] ?? {})).not.toContain("ascendancyName");
  });

  it("needs the access token and the run store", async () => {
    const a = app(
      () => stored,
      undefined,
      () => [],
    );
    expect(
      (await a.inject({ method: "GET", url: "/api/guides", headers: { host: headers.host } }))
        .statusCode,
    ).toBe(401);
    expect((await get("/api/guides", app(undefined))).statusCode).toBe(400);
  });
});
