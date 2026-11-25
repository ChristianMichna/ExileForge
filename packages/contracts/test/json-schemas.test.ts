import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderJsonSchemas } from "../src/index.js";

const schemaDir = fileURLToPath(new URL("../schemas", import.meta.url));

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe("generated JSON Schema files", () => {
  it("match the Zod schemas (run `pnpm --filter @astrolabe/contracts generate`)", () => {
    const expected = renderJsonSchemas();
    const onDisk = Object.fromEntries(
      listFiles(schemaDir).map((f) => [
        relative(schemaDir, f).split("\\").join("/"),
        readFileSync(f, "utf8").replace(/\r\n/g, "\n"),
      ]),
    );
    expect(Object.keys(onDisk).sort()).toEqual(Object.keys(expected).sort());
    for (const [path, content] of Object.entries(expected)) {
      expect(onDisk[path], path).toBe(content);
    }
  });
});
