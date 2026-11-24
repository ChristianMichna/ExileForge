import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pobSourcesSchema } from "../src/config.ts";
import { buildExtractJob } from "../src/pob/job.ts";

async function fakePobSrc(files: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ef-pob-"));
  for (const f of files) {
    const full = join(dir, ...f.split("/"));
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, "return {}\n");
  }
  return dir;
}

describe("buildExtractJob", () => {
  it("expands globs sorted, applies excludes and keeps tags", async () => {
    const src = await fakePobSrc([
      "Data/Things/b.lua",
      "Data/Things/a.lua",
      "Data/Things/skip.lua",
      "Data/Things/note.txt",
    ]);
    const sources = pobSourcesSchema.parse({
      kinds: [
        {
          kind: "things",
          functions: "marker",
          sources: [
            {
              loader: "fill",
              glob: "Data/Things/*.lua",
              exclude: ["Data/Things/skip.lua"],
              tag: { domains: "T" },
            },
          ],
        },
        {
          kind: "other",
          sources: [
            { loader: "return", file: "Data/One.lua" },
            { loader: "tree", treeVersion: "latest" },
          ],
        },
      ],
    });
    const job = await buildExtractJob(sources, src, "/out");
    expect(job).toEqual({
      outDir: "/out",
      kinds: [
        {
          kind: "things",
          functions: "marker",
          sources: [
            { loader: "fill", file: "Data/Things/a.lua", tag: { domains: "T" } },
            { loader: "fill", file: "Data/Things/b.lua", tag: { domains: "T" } },
          ],
        },
        {
          kind: "other",
          sources: [
            { loader: "return", file: "Data/One.lua" },
            { loader: "tree", treeVersion: "latest" },
          ],
        },
      ],
    });
  });

  it("fails when a glob matches nothing instead of producing an empty kind", async () => {
    const src = await fakePobSrc(["Data/Things/a.txt"]);
    const sources = pobSourcesSchema.parse({
      kinds: [{ kind: "things", sources: [{ loader: "fill", glob: "Data/Things/*.lua" }] }],
    });
    await expect(buildExtractJob(sources, src, "/out")).rejects.toThrow(/matches no file/);
  });

  it("fails when the glob directory does not exist", async () => {
    const src = await fakePobSrc([]);
    const sources = pobSourcesSchema.parse({
      kinds: [{ kind: "things", sources: [{ loader: "fill", glob: "Data/Nope/*.lua" }] }],
    });
    await expect(buildExtractJob(sources, src, "/out")).rejects.toThrow(/cannot list/);
  });
});
