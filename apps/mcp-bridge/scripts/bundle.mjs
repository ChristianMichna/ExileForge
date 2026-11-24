// Bundles the bridge into one file for the .mcpb package, so Claude Desktop
// needs nothing but its built-in Node runtime (no npm install on the friend's PC).
import { build } from "esbuild";

await build({
  entryPoints: ["dist/main.js"],
  outfile: "server/index.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  legalComments: "external",
});
