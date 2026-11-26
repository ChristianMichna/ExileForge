import { describe, expect, it } from "vitest";
import { DataReleaseId } from "@astrolabe/contracts";
import { ForgeError } from "../src/engine/errors.js";
import { createMemoryLogger } from "../src/logger.js";
import { RunStore } from "../src/store/run-store.js";
import { GuideSweeper } from "../src/tools/guide-sweep.js";

const CURRENT = DataReleaseId.parse("poe2-9.8.9+r1");
const OLD = "poe2-9.8.8+r1";
const ID = {
  a: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  c: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  d: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};
const ALL = [ID.a, ID.b, ID.c, ID.d];
let IDS = ALL;

function sweeper(store: RunStore, revalidate: (id: string) => Promise<unknown>) {
  return new GuideSweeper({
    listGuideIds: () => IDS,
    revalidate: ((input: { guideId: string }) => revalidate(input.guideId)) as never,
    builtWith: (id) => (id === ID.d ? CURRENT : OLD),
    save: (g, to, outcome, at) => store.savePatchCheck(g, to, outcome, at),
    list: (to) => store.listPatchChecks(to),
    currentReleaseId: CURRENT,
    now: () => new Date("2026-11-26T08:00:00Z"),
    logger: createMemoryLogger(),
  });
}

const GUIDE = "11111111-1111-4111-8111-111111111111";
const status = (to: string) => ({
  schemaVersion: 1,
  guideId: GUIDE,
  guideRevision: 0,
  fromReleaseId: OLD,
  toReleaseId: to,
  chain: [OLD, to],
  factChanges: [],
  checkedAt: "2026-11-26T08:00:00.000Z",
  checkedReferences: 0,
  verdict: "unaffected",
  findings: [],
});

describe("GuideSweeper", () => {
  it("stores a verdict, skips checked guides unless forced, hides vanished guides", async () => {
    IDS = [ID.a];
    const store = new RunStore(":memory:");
    let calls = 0;
    const s = sweeper(store, () => {
      calls += 1;
      return Promise.resolve(status(CURRENT));
    });
    await s.run();
    expect(s.view().guides[0]?.outcome.kind).toBe("status");
    await s.run();
    expect(calls).toBe(1);
    await s.run({ force: true });
    expect(calls).toBe(2);
    IDS = [];
    expect(s.view().guides).toEqual([]);
    IDS = ALL;
  });

  it("stop() waits for the current guide and does not write after it", async () => {
    const store = new RunStore(":memory:");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const s = sweeper(store, async () => {
      await gate;
      throw new ForgeError("diff_missing", "x");
    });
    const running = s.run();
    const stopping = s.stop();
    release();
    await stopping;
    await running;
    expect(store.listPatchChecks(CURRENT)).toEqual([]);
  });

  it("records a verdict or the error of every older guide and skips current ones", async () => {
    const store = new RunStore(":memory:");
    const calls: string[] = [];
    const s = sweeper(store, (id) => {
      calls.push(id);
      if (id === ID.a) return Promise.reject(new ForgeError("diff_missing", "chain incomplete"));
      if (id === ID.b) return Promise.reject(new Error("boom with /secret/path"));
      return Promise.reject(new ForgeError("guide_invalid", "damaged"));
    });
    await s.run();
    expect(calls).toEqual([ID.a, ID.b, ID.c]);
    const view = s.view();
    expect(view.running).toBe(false);
    expect(view.guides.map((g) => [g.guideId, g.outcome])).toEqual([
      [ID.a, { kind: "error", code: "diff_missing", message: "chain incomplete" }],
      [
        ID.b,
        { kind: "error", code: "internal", message: "The check failed. The app log has details." },
      ],
      [ID.c, { kind: "error", code: "guide_invalid", message: "damaged" }],
    ]);
  });

  it("does not run twice at once", async () => {
    const store = new RunStore(":memory:");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const s = sweeper(store, async () => {
      calls += 1;
      await gate;
      throw new ForgeError("diff_missing", "x");
    });
    const first = s.run();
    expect(s.run()).toBe(first);
    expect(s.view().running).toBe(true);
    release();
    await first;
    expect(calls).toBe(3);
  });
});

describe("RunStore guide helpers", () => {
  it("shows a damaged stored check as an internal error and keeps the others", () => {
    const store = new RunStore(":memory:");
    store.savePatchCheck(
      GUIDE,
      CURRENT,
      { kind: "error", code: "diff_missing", message: "x" },
      "2026-11-26T08:00:00.000Z",
    );
    store.savePatchCheck(
      "22222222-2222-4222-8222-222222222222",
      CURRENT,
      { kind: "error", code: "diff_missing", message: "x" },
      "2026-11-26T08:00:00.000Z",
    );
    // a row written by another version: unknown error code
    store.savePatchCheck(
      "33333333-3333-4333-8333-333333333333",
      CURRENT,
      { kind: "error", code: "from_the_future", message: "x" } as never,
      "2026-11-26T08:00:00.000Z",
    );
    const rows = store.listPatchChecks(CURRENT);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.guideId.startsWith("3333"))?.outcome).toMatchObject({
      kind: "error",
      code: "internal",
    });
  });

  it("overwrites a check of the same guide and release", () => {
    const store = new RunStore(":memory:");
    store.savePatchCheck(
      ID.a,
      CURRENT,
      { kind: "error", code: "diff_missing", message: "x" },
      "2026-11-26T08:00:00.000Z",
    );
    store.savePatchCheck(
      ID.a,
      CURRENT,
      { kind: "error", code: "guide_invalid", message: "y" },
      "2026-11-26T09:00:00.000Z",
    );
    const rows = store.listPatchChecks(CURRENT);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      checkedAt: "2026-11-26T09:00:00.000Z",
      outcome: { code: "guide_invalid" },
    });
    expect(store.listGuideIds()).toEqual([]);
  });
});
