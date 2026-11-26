import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryLogger } from "../src/logger.js";
import { writeFixtureRelease } from "./fixtures.js";

const root = join(import.meta.dirname, "../../..");

/** Start options for the fixture release without a calc engine; tests add `calc`. */
export function options() {
  const dir = mkdtempSync(join(tmpdir(), "astrolabe-start-"));
  return {
    port: 0,
    databasePath: join(dir, "db.sqlite"),
    catalogDir: writeFixtureRelease(),
    configPath: join(root, "config/forge/forge.json"),
    stagesConfigPath: join(root, "config/agents/stages.json"),
    allowedOrigins: [] as string[],
    tokenFile: join(dir, "token"),
    logger: createMemoryLogger(),
  };
}
