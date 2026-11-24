import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pobSourcesSchema } from "../src/config.ts";
import { extractRaw, pobInstallFromHome } from "../src/pob/extract.ts";

// Runs against the real pinned PoB when tools/setup_pob.sh has been run
// (locally and in the data-release workflow). Without .pob/ it is skipped and
// shows up as skipped in the test report.
const POB_HOME = fileURLToPath(new URL("../../../.pob", import.meta.url));
const pob = pobInstallFromHome(POB_HOME);
const hasPob = existsSync(pob.luajit) && existsSync(join(pob.srcDir, "HeadlessWrapper.lua"));
if (!hasPob && process.env.REQUIRE_POB === "1") {
  throw new Error(`REQUIRE_POB=1 but no PoB install at ${POB_HOME}`);
}

describe("extractRaw (missing PoB)", () => {
  it("fails with a hint to the setup script", async () => {
    const out = await mkdtemp(join(tmpdir(), "ef-out-"));
    const fake = pobInstallFromHome(join(out, "no-pob"));
    const sources = pobSourcesSchema.parse({
      kinds: [{ kind: "x", sources: [{ loader: "uniqueDB" }] }],
    });
    await expect(extractRaw(fake, sources, join(out, "raw"))).rejects.toThrow(/setup_pob/);
  });
});

describe.skipIf(!hasPob)("extractRaw (real PoB)", () => {
  const sources = pobSourcesSchema.parse({
    kinds: [
      { kind: "gems", sources: [{ loader: "return", file: "Data/Gems.lua" }] },
      {
        kind: "skills",
        functions: "marker",
        sources: [{ loader: "skills", glob: "Data/Skills/act_*.lua" }],
      },
      { kind: "passiveTree", sources: [{ loader: "tree", treeVersion: "latest" }] },
    ],
  });

  it("writes deterministic shards and meta", async () => {
    const a = await mkdtemp(join(tmpdir(), "ef-a-"));
    const b = await mkdtemp(join(tmpdir(), "ef-b-"));
    const metaA = await extractRaw(pob, sources, a);
    await extractRaw(pob, sources, b);
    expect(metaA.pobVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.keys(metaA.kinds).sort()).toEqual(["gems", "passiveTree", "skills"]);
    for (const kind of ["gems", "skills", "passiveTree"]) {
      const [ta, tb] = await Promise.all([
        readFile(join(a, `${kind}.json`), "utf8"),
        readFile(join(b, `${kind}.json`), "utf8"),
      ]);
      expect(ta).toBe(tb);
      const shard = JSON.parse(ta) as { kind: string; entities: Record<string, unknown> };
      expect(shard.kind).toBe(kind);
      expect(Object.keys(shard.entities).length).toBe(metaA.kinds[kind]);
    }
  });

  it("reports PoB errors instead of writing partial output", async () => {
    const out = await mkdtemp(join(tmpdir(), "ef-err-"));
    const broken = pobSourcesSchema.parse({
      kinds: [{ kind: "x", sources: [{ loader: "return", file: "Data/DoesNotExist.lua" }] }],
    });
    await expect(extractRaw(pob, broken, out)).rejects.toThrow(/PoB extraction failed/);
  });
});
