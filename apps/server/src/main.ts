#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { startCalcPool } from "@exileforge/calc";
import { DataReleaseId } from "@exileforge/contracts/common";
import { defaultTokenFile } from "./access-token.js";
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
    stages: { type: "string", default: "config/agents/stages.json" },
    calc: { type: "string" },
    "pob-root": { type: "string", default: "." },
    optimizer: { type: "string", default: "config/optimizer/tree.json" },
    origin: { type: "string", multiple: true, default: [] },
    "token-file": { type: "string", default: defaultTokenFile() },
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
if (values.calc !== "fake" && values.calc !== "pob") {
  logger.error(
    "--calc fake|pob is required (fake = calc-fake, pob = Path of Building worker pool)",
  );
  process.exit(2);
}

const badOrigin = values.origin.find((o) => !isExactOrigin(o));
if (badOrigin !== undefined) {
  logger.error("--origin must be an exact origin like http://127.0.0.1:5173", {
    origin: badOrigin,
  });
  process.exit(2);
}

async function chooseCalc(catalogDir: string): Promise<Parameters<typeof startServer>[0]["calc"]> {
  if (values.calc === "fake") return "fake";
  const manifest = JSON.parse(await readFile(`${catalogDir}/manifest.json`, "utf8")) as {
    release: { id: string };
  };
  // The pool stamps every result with the data release of the catalog the server uses.
  const pool = await startCalcPool({
    root: values["pob-root"],
    dataReleaseId: DataReleaseId.parse(manifest.release.id),
    onEvent: (event) => logger.info("calc pool", { event }),
  });
  return { engine: "pob", pool, optimizerConfigPath: values.optimizer };
}

const catalogDir = values.catalog;

chooseCalc(catalogDir)
  .then((calc) =>
    startServer({
      port,
      databasePath: values.db,
      catalogDir,
      configPath: values.config,
      stagesConfigPath: values.stages,
      calc,
      allowedOrigins: values.origin,
      tokenFile: values["token-file"],
      logger,
    }),
  )
  .catch((error: unknown) => {
    logger.error("server failed to start", { error });
    process.exit(1);
  });

function isExactOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}
