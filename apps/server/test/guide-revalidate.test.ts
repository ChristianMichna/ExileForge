import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { CalcFake } from "../src/calc/calc-fake.js";
import { ForgeEngine } from "../src/engine/forge-engine.js";
import { RunRecord } from "../src/engine/run-record.js";
import { createMemoryLogger } from "../src/logger.js";
import { createForgeMcpServer } from "../src/mcp/forge-mcp.js";
import { RunStore } from "../src/store/run-store.js";
import { createGuideRevalidate } from "../src/tools/guide-revalidate.js";
import { CONFIG, RELEASE, fixtureCatalog } from "./fixtures.js";
import { guide, releaseId as OWN } from "./guide-fixture.js";

const NEXT = "poe2-9.8.8+r1";
const LATER = "poe2-9.8.8+r2";
const UNRELATED = "poe2-1.0.0+r1";
const GUIDE_ID = guide.metadata.guideId;
const now = () => new Date("2026-11-26T05:00:00Z");

function addRelease(root: string, id: string, previous?: string, diff?: object): void {
  const dir = join(root, id);
  mkdirSync(dir);
  const [, version, rev] = /^poe2-(.+)\+r(\d+)$/.exec(id) ?? [];
  const release = {
    id,
    gameVersion: version,
    pobVersion: "v9.9.9",
    pipelineRevision: Number(rev),
    sourceHashes: {},
    createdAt: "2026-01-01T00:00:00Z",
    ...(previous === undefined ? {} : { previousReleaseId: previous, diffPath: "diff.json" }),
  };
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, release, shards: [] }),
  );
  if (diff) writeFileSync(join(dir, "diff.json"), JSON.stringify(diff));
}
const diffOf = (from: string, to: string, kinds: object = {}) => ({
  schemaVersion: 1,
  from,
  to,
  kinds,
});

function setup(guideValue: unknown = guide) {
  const root = mkdtempSync(join(tmpdir(), "astrolabe-releases-"));
  addRelease(root, OWN);
  addRelease(
    root,
    NEXT,
    OWN,
    diffOf(OWN, NEXT, { gem: { added: [], removed: ["Fixture/Gems/Support"], changed: [] } }),
  );
  addRelease(root, LATER, NEXT, diffOf(NEXT, LATER));
  addRelease(root, UNRELATED);
  const tool = createGuideRevalidate({
    findGuide: (id) => (id === GUIDE_ID ? guideValue : undefined),
    releasesDir: root,
    now,
  });
  return { root, tool };
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => "no error",
    (e: unknown) => (e as { code?: string }).code,
  );

describe("createGuideRevalidate", () => {
  it("walks the chain from the target back to the guide's release", async () => {
    const { tool } = setup();
    const status = await tool({ guideId: GUIDE_ID, toReleaseId: LATER as never });
    expect(status.chain).toEqual([OWN, NEXT, LATER]);
    expect(status.verdict).toBe("broken");
    expect(status.checkedAt).toBe("2026-11-26T05:00:00.000Z");
  });
  it("answers with the documented error codes", async () => {
    const { tool, root } = setup();
    const to = (toReleaseId: string, guideId = GUIDE_ID) =>
      tool({ guideId, toReleaseId: toReleaseId as never });
    expect(await code(to(NEXT, "00000000-0000-4000-8000-0000000000ff"))).toBe("guide_not_found");
    expect(await code(to("poe2-7.7.7+r9"))).toBe("release_unknown");
    expect(await code(to(OWN))).toBe("release_not_newer");
    expect(await code(to(UNRELATED))).toBe("release_not_newer");
    // a release of the chain whose diff file is missing
    addRelease(root, "poe2-9.9.9+r1", LATER);
    expect(await code(to("poe2-9.9.9+r1"))).toBe("diff_missing");
    // a gap: the predecessor is not installed
    addRelease(root, "poe2-9.9.9+r2", "poe2-9.9.9+r0", diffOf("poe2-9.9.9+r0", "poe2-9.9.9+r2"));
    expect(await code(to("poe2-9.9.9+r2"))).toBe("diff_missing");
  });
  it("rejects a stored guide that is not valid", async () => {
    const { tool } = setup({ metadata: { dataReleaseId: "nonsense" } });
    expect(await code(tool({ guideId: GUIDE_ID, toReleaseId: NEXT as never }))).toBe(
      "guide_invalid",
    );
    const broken = setup({ metadata: { dataReleaseId: OWN } });
    expect(await code(broken.tool({ guideId: GUIDE_ID, toReleaseId: NEXT as never }))).toBe(
      "diff_missing",
    );
  });
});

describe("RunStore.findGuide", () => {
  it("finds the guide of a finished run by id and nothing for unknown ids", () => {
    const store = new RunStore(":memory:");
    expect(store.findGuide(GUIDE_ID)).toBeUndefined();
    const record = RunRecord.parse({
      runId: "00000000-0000-4000-8000-0000000000aa",
      pipelineId: "forge",
      createdAt: "2026-01-01T00:00:00Z",
      request: guide.request,
      phase: "done",
      sessionCode: null,
      results: {
        "S11.guide": { type: "S11", by: "server", value: guide, at: "2026-01-01T00:00:00Z" },
      },
      current: null,
      interventions: [],
      asks: [],
      taskCounter: 1,
      nextSeq: 1,
      guideId: GUIDE_ID,
    });
    store.save(record, []);
    expect(store.findGuide(GUIDE_ID)).toEqual(guide);
    expect(store.findGuide("00000000-0000-4000-8000-0000000000ff")).toBeUndefined();
  });
});

describe("MCP tool guide_revalidate", () => {
  async function connect(withTool: boolean) {
    const catalog = fixtureCatalog();
    const calc = new CalcFake({ dataReleaseId: RELEASE });
    const { tool } = setup();
    const server = createForgeMcpServer({
      engine: new ForgeEngine({
        store: new RunStore(":memory:"),
        catalog,
        calc,
        config: CONFIG,
        pipelines: [],
        calcProfiles: ["default"],
      }),
      catalog,
      calc,
      calcProfiles: ["default"],
      waitLongPollSeconds: 0,
      logger: createMemoryLogger(),
      ...(withTool ? { guideRevalidate: tool } : {}),
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }
  it("exists only when configured, answers a PatchStatus and returns codes as tool errors", async () => {
    expect(
      (await (await connect(false)).listTools()).tools.some((t) => t.name === "guide_revalidate"),
    ).toBe(false);
    const client = await connect(true);
    const ok = await client.callTool({
      name: "guide_revalidate",
      arguments: { guideId: GUIDE_ID, toReleaseId: NEXT },
    });
    expect(ok.isError).toBeFalsy();
    expect((ok.structuredContent as { verdict: string }).verdict).toBe("broken");
    const bad = await client.callTool({
      name: "guide_revalidate",
      arguments: { guideId: GUIDE_ID, toReleaseId: OWN },
    });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toContain("release_not_newer");
  });
});
