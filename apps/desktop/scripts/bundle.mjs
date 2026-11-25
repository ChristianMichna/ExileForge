// Bundles the main process and the preload script. Everything except Electron
// itself goes into the bundle, so the installer ships no node_modules.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["electron"],
  legalComments: "external",
  logLevel: "info",
};

await build({ ...common, entryPoints: ["src/main/main.ts"], outfile: "dist/main.cjs" });
await build({ ...common, entryPoints: ["src/preload.ts"], outfile: "dist/preload.cjs" });
