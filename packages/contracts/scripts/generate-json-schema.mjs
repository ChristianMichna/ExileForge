// Writes schemas/**/*.schema.json from the built package (run `pnpm generate`).
// Generated files are not edited by hand; a snapshot test keeps them in sync.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderJsonSchemas } from "../dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
await rm(root, { recursive: true, force: true });
const files = renderJsonSchemas();
for (const [path, content] of Object.entries(files)) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}
console.log(`Wrote ${Object.keys(files).length} schema files to ${root}`);
