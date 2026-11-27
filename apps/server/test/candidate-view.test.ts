import { describe, expect, it } from "vitest";
import { DataReleaseId } from "@astrolabe/contracts/common";
import type { JsonValue } from "@astrolabe/contracts/common";
import { BuildState } from "@astrolabe/contracts/build";
import { CalcFake } from "../src/calc/calc-fake.js";
import { ForgeEngine } from "../src/engine/forge-engine.js";
import type { RunRecord } from "../src/engine/run-record.js";
import { createApp } from "../src/http/app.js";
import { createMemoryLogger } from "../src/logger.js";
import { createPocPipeline } from "../src/pipelines/poc-pipeline.js";
import { buildCandidateView } from "../src/runs/candidate-view.js";
import { PersistedCalc } from "../src/calc/persisted-calc.js";
import { RunStore } from "../src/store/run-store.js";
import { CONFIG, REQUEST, RELEASE, candidate, fixtureCatalog } from "./fixtures.js";

const TOKEN = "e".repeat(64);
const headers = { host: "127.0.0.1:1", authorization: `Bearer ${TOKEN}` };
const state = BuildState.parse({
  classId: "FixClassA",
  ascendancyId: "FixAscA1",
  level: 10,
  tree: { allocated: [] },
  skills: [],
  items: [],
});
const json = (v: unknown): JsonValue => JSON.parse(JSON.stringify(v)) as JsonValue;
const at = "2026-11-27T00:00:00.000Z";
const stored = (type: string, value: JsonValue, by: "claude" | "server" = "server") => ({
  type,
  by,
  value,
  at,
});

function setup() {
  const store = new RunStore(":memory:");
  const catalog = fixtureCatalog();
  const calc = new PersistedCalc(new CalcFake({ dataReleaseId: RELEASE }), store);
  const engine = new ForgeEngine({
    store,
    catalog,
    calc,
    config: CONFIG,
    pipelines: [createPocPipeline(CONFIG.pipelines.poc)],
    calcProfiles: ["default"],
  });
  const app = createApp({
    engine,
    catalog,
    calc,
    calcProfiles: ["default"],
    waitLongPollSeconds: 0,
    logger: createMemoryLogger(),
    port: 1,
    allowedOrigins: [],
    defaultPipelineId: "poc",
    accessToken: TOKEN,
  });
  return { app, catalog, calc };
}

function run(overrides: Partial<RunRecord>): RunRecord {
  return {
    runId: "run-1",
    pipelineId: "forge",
    createdAt: at,
    request: REQUEST,
    phase: "running",
    sessionCode: null,
    results: {},
    current: null,
    interventions: [],
    asks: [],
    taskCounter: 0,
    nextSeq: 0,
    returns: {},
    returned: {},
    ...overrides,
  } as RunRecord;
}

describe("buildCandidateView", () => {
  it("lists candidates in order with names, measurements and the pick", async () => {
    const { catalog, calc } = setup();
    const outcomes = await calc.calculate({ state, profiles: ["default"] });
    const view = await buildCandidateView(
      run({
        results: {
          "S2.candidate-2": stored("S2.candidate", candidate("b", "FixClassB", "FixAscB1")),
          "S2.candidate-1": stored("S2.candidate", candidate("a", "FixClassA", "FixAscA1")),
          "S3.evaluations": stored("S3.evaluate", [
            { candidateKey: "a", skeleton: json(state), calcs: json(outcomes) },
          ]),
          "S4.selection": stored("S4.select", { candidateKey: "a" }),
        },
      }),
      catalog,
      calc,
    );
    expect(view.candidates.map((c) => c.key)).toEqual(["a", "b"]);
    expect(view.chosenKey).toBe("a");
    expect(view.current).toBe(true);
    expect(view.names["gem:FixGemMain"]).toBe("Fixture FixGemMain");
    expect(view.names["characterClass:FixClassA"]).toBe("Fixture Class A");
    const calcId = Object.values(outcomes).flatMap((o) => (o.status === "ok" ? [o.calcId] : []))[0];
    expect(calcId && view.results[calcId]?.calcId).toBe(calcId);
    expect(view.unresolved).toEqual([]);
  });

  it("reads the pick of the proof-of-concept pipeline from the interventions", async () => {
    const { catalog, calc } = setup();
    const results = {
      "S2.candidate-1": stored("S2.candidate", candidate("a", "FixClassA", "FixAscA1")),
    };
    const view = await buildCandidateView(
      run({
        results,
        interventions: [
          { intervention: { kind: "chooseVariant", candidateKey: "a" }, at, delivered: true },
        ],
      }),
      catalog,
      calc,
    );
    expect(view.chosenKey).toBe("a");
    // A pick of something that is not a candidate is not reported.
    const stray = await buildCandidateView(
      run({
        results,
        interventions: [
          { intervention: { kind: "chooseVariant", candidateKey: "zz" }, at, delivered: true },
        ],
      }),
      catalog,
      calc,
    );
    expect(stray.chosenKey).toBeUndefined();
  });

  it("lists a missing result and gives no names for a run of another release", async () => {
    const { catalog, calc } = setup();
    const view = await buildCandidateView(
      run({
        request: { ...REQUEST, dataReleaseId: DataReleaseId.parse("poe2-1.0.0+r1") },
        results: {
          "S2.candidate-1": stored("S2.candidate", candidate("a", "FixClassA", "FixAscA1")),
          "S3.evaluations": stored("S3.evaluate", [
            {
              candidateKey: "a",
              skeleton: json(state),
              calcs: { default: { status: "ok", calcId: "gone-1" } },
            },
          ]),
        },
      }),
      catalog,
      calc,
    );
    expect(view.current).toBe(false);
    expect(view.names).toEqual({});
    expect(view.unresolved).toContain("gem:FixGemMain");
    expect(view.unresolved).toContain("calc:gone-1");
  });

  it("uses only the measurement of the current candidates (PoC key) and ignores an older one", async () => {
    const { catalog, calc } = setup();
    const outcomes = await calc.calculate({ state, profiles: ["default"] });
    const measured = (key: string) => [
      { candidateKey: key, skeleton: json(state), calcs: json(outcomes) },
    ];
    const view = await buildCandidateView(
      run({
        results: {
          "S2.candidate-1": stored("S2.candidate", candidate("a", "FixClassA", "FixAscA1")),
          "S3.evaluate:old": stored("S3.evaluate", measured("old")),
          "S3.evaluate:a": stored("S3.evaluate", measured("a")),
        },
      }),
      catalog,
      calc,
    );
    expect(view.evaluations.map((e) => e.candidateKey)).toEqual(["a"]);
    const stale = await buildCandidateView(
      run({
        results: {
          "S2.candidate-1": stored("S2.candidate", candidate("a", "FixClassA", "FixAscA1")),
          "S3.evaluate:old": stored("S3.evaluate", measured("old")),
        },
      }),
      catalog,
      calc,
    );
    expect(stale.evaluations).toEqual([]);
  });

  it("does not pass on a result of another data release", async () => {
    const { catalog, calc } = setup();
    const outcomes = await calc.calculate({ state, profiles: ["default"] });
    const other = DataReleaseId.parse("poe2-1.0.0+r1");
    const view = await buildCandidateView(
      run({
        request: { ...REQUEST, dataReleaseId: other },
        results: {
          "S2.candidate-1": stored("S2.candidate", candidate("a", "FixClassA", "FixAscA1")),
          "S3.evaluations": stored("S3.evaluate", [
            { candidateKey: "a", skeleton: json(state), calcs: json(outcomes) },
          ]),
        },
      }),
      catalog,
      calc,
    );
    expect(view.results).toEqual({});
    expect(view.unresolved.some((u) => u.startsWith("calc:"))).toBe(true);
  });

  it("lists a stored pick of an unknown candidate instead of dropping it", async () => {
    const { catalog, calc } = setup();
    const view = await buildCandidateView(
      run({
        results: {
          "S2.candidate-1": stored("S2.candidate", candidate("a", "FixClassA", "FixAscA1")),
          "S4.selection": stored("S4.select", { candidateKey: "zz" }),
        },
      }),
      catalog,
      calc,
    );
    expect(view.chosenKey).toBeUndefined();
    expect(view.unresolved).toContain("selection:zz");
  });

  it("fails visibly on a stored candidate that is not valid", async () => {
    const { catalog, calc } = setup();
    await expect(
      buildCandidateView(
        run({ results: { "S2.candidate-1": stored("S2.candidate", { key: "a" }) } }),
        catalog,
        calc,
      ),
    ).rejects.toThrow(/not valid/);
  });
});

describe("GET /api/runs/:runId/candidates", () => {
  it("answers an empty view for a new run and 404 for an unknown run", async () => {
    const { app } = setup();
    const created = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers,
      payload: { request: REQUEST },
    });
    const { runId } = created.json() as { runId: string };
    const res = await app.inject({ method: "GET", url: `/api/runs/${runId}/candidates`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ runId, candidates: [], evaluations: [], current: true });
    const missing = await app.inject({
      method: "GET",
      url: "/api/runs/00000000-0000-4000-8000-000000000000/candidates",
      headers,
    });
    expect(missing.statusCode).toBe(404);
  });
});
