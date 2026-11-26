import { describe, expect, it } from "vitest";
import { GUIDE_FILE_FORMAT, GuideFile } from "@astrolabe/contracts/guide";
import { CalcFake } from "../src/calc/calc-fake.js";
import { PersistedCalc } from "../src/calc/persisted-calc.js";
import { ForgeEngine } from "../src/engine/forge-engine.js";
import { createApp } from "../src/http/app.js";
import { collectCalcIds } from "../src/guides/guide-view.js";
import { createMemoryLogger } from "../src/logger.js";
import { createPocPipeline } from "../src/pipelines/poc-pipeline.js";
import type { CalcPort } from "../src/ports/calc.js";
import { RunStore } from "../src/store/run-store.js";
import { guide } from "./guide-fixture.js";
import { CONFIG, RELEASE, fixtureCatalog } from "./fixtures.js";

const TOKEN = "d".repeat(64);
const headers = { host: "127.0.0.1:1", authorization: `Bearer ${TOKEN}` };
const GUIDE_ID = guide.metadata.guideId;
const validation = { gates: [], completenessScore: 100, scoringConfigVersion: "1", passed: true };
const stored = {
  ...guide,
  validation,
  metadata: { ...guide.metadata, dataReleaseId: RELEASE },
};
const resultOf = (calcId: string, stat = 1) => ({
  calcId,
  pobVersion: "v0.23.1",
  dataReleaseId: RELEASE,
  calcProfile: "default",
  inputHash: "a".repeat(64),
  computedAt: "2026-11-26T12:00:00Z",
  stats: { FixtureStatA: stat },
  warnings: [],
  unsupportedMods: [],
});
const calcIds = collectCalcIds(stored);
const file = {
  format: GUIDE_FILE_FORMAT,
  version: 1,
  guide: stored,
  results: Object.fromEntries(calcIds.map((id) => [id, resultOf(id)])),
};

function appOver(store: RunStore) {
  const catalog = fixtureCatalog();
  const calc: CalcPort = new PersistedCalc(new CalcFake({ dataReleaseId: RELEASE }), store);
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
    findGuide: (id) => store.findGuide(id),
    listGuideIds: () => store.listGuideIds(),
    importGuide: (f, at) => store.importGuide(f, at),
  });
}

describe("RunStore.importGuide", () => {
  it("stores the guide and its results and finds them again", () => {
    const store = new RunStore(":memory:");
    expect(calcIds.length).toBeGreaterThan(0);
    store.importGuide(GuideFile.parse(file), "2026-11-26T12:00:00Z");
    expect(store.listGuideIds()).toEqual([GUIDE_ID]);
    expect(store.findGuide(GUIDE_ID)).toMatchObject({ metadata: { guideId: GUIDE_ID } });
    expect(store.loadCalcResult(calcIds[0] as string)).toEqual(resultOf(calcIds[0] as string));
  });

  it("accepts the same file again and refuses a different result under a stored calcId", () => {
    const store = new RunStore(":memory:");
    store.importGuide(GuideFile.parse(file), "2026-11-26T12:00:00Z");
    store.importGuide(GuideFile.parse(file), "2026-11-26T12:05:00Z");
    expect(store.listGuideIds()).toEqual([GUIDE_ID]);
    const id = calcIds[0] as string;
    const changed = GuideFile.parse({
      ...file,
      results: { ...file.results, [id]: resultOf(id, 2) },
    });
    expect(() => store.importGuide(changed, "2026-11-26T12:10:00Z")).toThrow(/differs/);
    expect(store.loadCalcResult(id)).toEqual(resultOf(id));
  });
});

describe("guide file routes", () => {
  it("imports a file, then shows the guide with its stored numbers", async () => {
    const a = appOver(new RunStore(":memory:"));
    const res = await a.inject({
      method: "POST",
      url: "/api/guides/import",
      headers,
      payload: file,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ guideId: GUIDE_ID });
    const list = await a.inject({ method: "GET", url: "/api/guides", headers });
    expect(list.json<{ guides: { guideId: string }[] }>().guides[0]?.guideId).toBe(GUIDE_ID);
    const view = await a.inject({ method: "GET", url: `/api/guides/${GUIDE_ID}/view`, headers });
    expect(view.statusCode).toBe(200);
    const body = view.json<{ results: Record<string, unknown> }>();
    expect(Object.keys(body.results)).toEqual(calcIds);
  });

  it("rejects a file that is not a guide file, and needs the access token", async () => {
    const a = appOver(new RunStore(":memory:"));
    const bad = await a.inject({
      method: "POST",
      url: "/api/guides/import",
      headers,
      payload: { ...file, format: "other" },
    });
    expect(bad.statusCode).toBe(400);
    const open = await a.inject({
      method: "POST",
      url: "/api/guides/import",
      headers: { host: headers.host },
      payload: file,
    });
    expect(open.statusCode).toBe(401);
  });

  it("exports an imported guide as a file that imports again", async () => {
    const a = appOver(new RunStore(":memory:"));
    await a.inject({ method: "POST", url: "/api/guides/import", headers, payload: file });
    const out = await a.inject({ method: "GET", url: `/api/guides/${GUIDE_ID}/file`, headers });
    expect(out.statusCode).toBe(200);
    const exported = GuideFile.parse(out.json());
    expect(Object.keys(exported.results)).toEqual(calcIds);
    const b = appOver(new RunStore(":memory:"));
    const again = await b.inject({
      method: "POST",
      url: "/api/guides/import",
      headers,
      payload: exported,
    });
    expect(again.statusCode).toBe(201);
  });

  it("does not export a guide whose results are missing", async () => {
    const store = new RunStore(":memory:");
    store.importGuide(GuideFile.parse({ ...file, results: {} }), "2026-11-26T12:00:00Z");
    const out = await appOver(store).inject({
      method: "GET",
      url: `/api/guides/${GUIDE_ID}/file`,
      headers,
    });
    expect(out.statusCode).toBe(400);
    expect(out.json<{ message?: string; error?: string }>()).toBeDefined();
  });
});
