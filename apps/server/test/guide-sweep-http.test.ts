import { describe, expect, it } from "vitest";
import { DataReleaseId, GuidePatchStatusView } from "@astrolabe/contracts";
import { CalcFake } from "../src/calc/calc-fake.js";
import { ForgeEngine } from "../src/engine/forge-engine.js";
import { createApp } from "../src/http/app.js";
import { createMemoryLogger } from "../src/logger.js";
import { createPocPipeline } from "../src/pipelines/poc-pipeline.js";
import { RunStore } from "../src/store/run-store.js";
import { GuideSweeper } from "../src/tools/guide-sweep.js";
import { CONFIG, RELEASE, fixtureCatalog } from "./fixtures.js";

const TOKEN = "b".repeat(64);
const headers = { host: "127.0.0.1:1", authorization: `Bearer ${TOKEN}` };

function app(withSweep: boolean) {
  const store = new RunStore(":memory:");
  const catalog = fixtureCatalog();
  const calc = new CalcFake({ dataReleaseId: RELEASE });
  const sweeper = new GuideSweeper({
    listGuideIds: () => store.listGuideIds(),
    revalidate: () => Promise.reject(new Error("not used")),
    builtWith: () => undefined,
    save: (g, to, o, at) => store.savePatchCheck(g, to, o, at),
    list: (to) => store.listPatchChecks(to),
    currentReleaseId: DataReleaseId.parse(RELEASE),
    now: () => new Date(),
    logger: createMemoryLogger(),
  });
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
    ...(withSweep ? { guideSweep: sweeper } : {}),
  });
}

describe("guide patch-status routes", () => {
  it("need the access token", async () => {
    const res = await app(true).inject({
      method: "GET",
      url: "/api/guides/patch-status",
      headers: { host: headers.host },
    });
    expect(res.statusCode).toBe(401);
  });

  it("say when the check is switched off instead of returning an empty list", async () => {
    const a = app(false);
    const view = await a.inject({ method: "GET", url: "/api/guides/patch-status", headers });
    expect(GuidePatchStatusView.parse(view.json())).toMatchObject({ enabled: false, guides: [] });
    const refresh = await a.inject({
      method: "POST",
      url: "/api/guides/patch-status/refresh",
      headers,
    });
    expect(refresh.statusCode).toBe(400);
  });

  it("return the view and accept a refresh", async () => {
    const a = app(true);
    const view = await a.inject({ method: "GET", url: "/api/guides/patch-status", headers });
    expect(GuidePatchStatusView.parse(view.json())).toMatchObject({
      enabled: true,
      running: false,
      guides: [],
    });
    const refresh = await a.inject({
      method: "POST",
      url: "/api/guides/patch-status/refresh",
      headers,
    });
    expect(refresh.statusCode).toBe(202);
  });
});
