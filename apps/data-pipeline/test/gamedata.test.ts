import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gameDataConfigSchema, loadGameDataConfig } from "../src/gamedata/config.ts";
import {
  TableMissingError,
  exportGameData,
  readGameDataManifest,
  readGameDataTable,
  type DatTool,
  type TableRunner,
} from "../src/gamedata/export.ts";
import { parsePatchReply } from "../src/gamedata/patch.ts";

// A reply recorded from the update server (binary header, then the base url
// as UTF-16LE, announced twice).
const RECORDED_REPLY = Buffer.from(
  "0200000000000000000000000000000000000000000000000000000000000000000027680074007400700073003a002f002f00700061007400630068002d0070006f00650032002e0070006f006500630064006e002e0063006f006d002f0030002e0035002e0035002e00310030002f000027680074007400700073003a002f002f00700061007400630068002d0070006f00650032002e0070006f006500630064006e002e0063006f006d002f0030002e0035002e0035002e00310030002f00",
  "hex",
);

describe("parsePatchReply", () => {
  it("reads the base url and version from a recorded reply", () => {
    expect(parsePatchReply(RECORDED_REPLY)).toEqual({
      url: "https://patch-poe2.poecdn.com/0.5.5.10/",
      version: "0.5.5.10",
    });
  });

  it("does not depend on the header layout", () => {
    const url = Buffer.from("https://cdn.example/1.2.3/", "utf16le");
    for (const pad of [0, 1, 7, 34]) {
      const reply = Buffer.concat([Buffer.alloc(pad, 2), url, Buffer.alloc(2)]);
      expect(parsePatchReply(reply).version).toBe("1.2.3");
    }
  });

  it("fails on a reply without url or with an url that has no version", () => {
    expect(() => parsePatchReply(Buffer.alloc(40))).toThrow(/holds no url/);
    const odd = Buffer.concat([
      Buffer.from("https://cdn.example/latest/", "utf16le"),
      Buffer.alloc(2),
    ]);
    expect(() => parsePatchReply(odd)).toThrow(/unexpected url/);
  });
});

describe("game-data config", () => {
  it("accepts the shipped config", async () => {
    const cfg = await loadGameDataConfig(
      fileURLToPath(new URL("../../../config/data-pipeline/game-data.json", import.meta.url)),
    );
    expect(cfg.tables.length).toBeGreaterThan(0);
    expect(cfg.tables.every((t) => typeof t.required === "boolean")).toBe(true);
  });

  it("rejects duplicate table names", () => {
    const cfg = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../../../config/data-pipeline/game-data.json", import.meta.url)),
        "utf8",
      ),
    ) as { tables: { name: string; columns: string[] }[] };
    cfg.tables.push({ name: "Twice", columns: ["A"] }, { name: "Twice", columns: ["B"] });
    expect(() => gameDataConfigSchema.parse(cfg)).toThrow(/unique/);
  });
});

// ---- export with a fake dat tool; tables and values are invented

const config = gameDataConfigSchema.parse({
  patchServer: { host: "patch.example", port: 1, handshake: [1], timeoutMs: 1000 },
  schemaUrl: "https://schema.example/schema.json",
  language: "English",
  toolTimeoutMs: 1000,
  tables: [
    { name: "Things", columns: ["Id", "Name"] },
    { name: "Extras", columns: ["Thing"], required: false },
  ],
});
const patch = { url: "https://cdn.example/9.9.9/", version: "9.9.9" };
const schema = { url: config.schemaUrl, sha256: "b".repeat(64) };
const NOW = new Date("2026-01-01T00:00:00.000Z");

function fakeTool(
  tables: Record<string, unknown[] | "missing" | "broken">,
  seen: string[] = [],
): DatTool {
  const run: TableRunner = async (job) => {
    seen.push(job.table.name);
    const rows = tables[job.table.name];
    if (rows === "missing") throw new TableMissingError(`table ${job.table.name} is not in patch`);
    if (rows === "broken") throw new Error(`tool failed on table ${job.table.name}`);
    if (rows === undefined) return; // writes nothing
    const dir = join(job.workDir, "tables", job.language);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${job.table.name}.json`), JSON.stringify(rows));
  };
  return { name: "fake-dat", version: "1.0.0", run };
}

const things = [
  { _index: 0, Id: "thing/a", Name: "Alpha" },
  { _index: 1, Id: "thing/b", Name: "Beta" },
];
const extras = [{ _index: 0, Thing: 1 }];

async function out(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "ef-gd-")), "game-data");
}

describe("exportGameData", () => {
  it("writes hashed tables and a manifest that the reader verifies", async () => {
    const dir = await out();
    const manifest = await exportGameData({
      config,
      patch,
      outDir: dir,
      tool: fakeTool({ Things: things, Extras: extras }),
      schema,
      now: NOW,
    });
    expect(manifest).toMatchObject({
      patch,
      tool: { name: "fake-dat", version: "1.0.0" },
      schema,
      createdAt: NOW.toISOString(),
      missing: [],
    });
    expect(manifest.tables.map((t) => [t.name, t.count])).toEqual([
      ["Things", 2],
      ["Extras", 1],
    ]);
    const read = await readGameDataManifest(dir);
    expect(await readGameDataTable(dir, read, "Things")).toEqual(things);
  });

  it("records an optional table the patch lacks and says so when it is read", async () => {
    const dir = await out();
    const manifest = await exportGameData({
      config,
      patch,
      outDir: dir,
      tool: fakeTool({ Things: things, Extras: "missing" }),
      schema,
      now: NOW,
    });
    expect(manifest.tables.map((t) => t.name)).toEqual(["Things"]);
    expect(manifest.missing).toEqual([{ name: "Extras", reason: "table Extras is not in patch" }]);
    await expect(readGameDataTable(dir, manifest, "Extras")).rejects.toThrow(
      /missing in patch 9.9.9/,
    );
    await expect(readGameDataTable(dir, manifest, "Nope")).rejects.toThrow(/no table Nope/);
  });

  it("fails when a required table is missing or the tool fails", async () => {
    await expect(
      exportGameData({
        config,
        patch,
        outDir: await out(),
        tool: fakeTool({ Things: "missing", Extras: extras }),
        schema,
      }),
    ).rejects.toThrow(TableMissingError);
    await expect(
      exportGameData({
        config,
        patch,
        outDir: await out(),
        tool: fakeTool({ Things: things, Extras: "broken" }),
        schema,
      }),
    ).rejects.toThrow(/tool failed on table Extras/);
  });

  it("rejects exports that do not look like the configured table", async () => {
    const bad = async (tables: Record<string, unknown[]>) => {
      const dir = await out();
      return exportGameData({ config, patch, outDir: dir, tool: fakeTool(tables), schema });
    };
    await expect(bad({ Things: [] })).rejects.toThrow(/unexpected export/);
    await expect(bad({ Things: [{ _index: 1, Id: "x", Name: "y" }] })).rejects.toThrow(/_index 1/);
    await expect(bad({ Things: [{ _index: 0, Id: "x" }] })).rejects.toThrow(/no column Name/);
    await expect(bad({ Things: things, Extras: [{ _index: 0, Other: 1 }] })).rejects.toThrow(
      /no column Thing/,
    );
  });

  it("fails when the tool writes no export", async () => {
    await expect(
      exportGameData({ config, patch, outDir: await out(), tool: fakeTool({}), schema }),
    ).rejects.toThrow(/no readable export/);
  });

  it("detects a table file that changed after the export", async () => {
    const dir = await out();
    const manifest = await exportGameData({
      config,
      patch,
      outDir: dir,
      tool: fakeTool({ Things: things, Extras: extras }),
      schema,
    });
    await writeFile(join(dir, "Things.json"), JSON.stringify(things.slice(0, 1)) + "\n");
    await expect(readGameDataTable(dir, manifest, "Things")).rejects.toThrow(/manifest hash/);
  });

  it("refuses an output directory that is the working directory or a foreign folder", async () => {
    await expect(
      exportGameData({ config, patch, outDir: process.cwd(), tool: fakeTool({}), schema }),
    ).rejects.toThrow(/would delete the working directory/);
    const foreign = await mkdtemp(join(tmpdir(), "ef-foreign-"));
    await writeFile(join(foreign, "keep.txt"), "x");
    await expect(
      exportGameData({ config, patch, outDir: foreign, tool: fakeTool({}), schema }),
    ).rejects.toThrow(/not an earlier output/);
    expect(existsSync(join(foreign, "keep.txt"))).toBe(true);
  });
});
