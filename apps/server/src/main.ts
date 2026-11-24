#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createStderrLogger } from "./logger.js";
import { DEFAULT_PORT, startServer } from "./start.js";

/*
 * Development entry point. In the packaged app, apps/desktop calls
 * startServer() directly with paths inside the user's app data folder.
 */
const { values } = parseArgs({
  options: {
    port: { type: "string", default: String(DEFAULT_PORT) },
    db: { type: "string", default: "exileforge.sqlite" },
    catalog: { type: "string" },
    config: { type: "string", default: "config/forge/forge.json" },
    calc: { type: "string" },
    origin: { type: "string", multiple: true, default: [] },
  },
});

const logger = createStderrLogger("server");
const port = Number(values.port);
if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  logger.error("invalid --port", { port: values.port });
  process.exit(2);
}
if (values.catalog === undefined) {
  logger.error("--catalog <data release dir> is required");
  process.exit(2);
}
if (values.calc !== "fake") {
  logger.error("--calc fake is required until the PoB worker pool is connected");
  process.exit(2);
}

startServer({
  port,
  databasePath: values.db,
  catalogDir: values.catalog,
  configPath: values.config,
  calc: "fake",
  allowedOrigins: values.origin,
  logger,
}).catch((error: unknown) => {
  logger.error("server failed to start", { error });
  process.exit(1);
});
