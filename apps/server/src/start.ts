import type { FastifyInstance } from "fastify";
import { loadOrCreateAccessToken } from "./access-token.js";
import { CalcFake } from "./calc/calc-fake.js";
import { PersistedCalc } from "./calc/persisted-calc.js";
import { loadCatalogRelease } from "./catalog/memory-catalog.js";
import { loadForgeConfig } from "./config/forge-config.js";
import { ForgeEngine } from "./engine/forge-engine.js";
import { createApp, LOOPBACK_HOST } from "./http/app.js";
import type { Logger } from "./logger.js";
import { createPocPipeline } from "./pipelines/poc-pipeline.js";
import { RunStore } from "./store/run-store.js";

/** Default local port; the .mcpb bridge uses the same default. */
export const DEFAULT_PORT = 47615;

export interface StartOptions {
  port: number;
  /** SQLite file for runs and events. */
  databasePath: string;
  /** Directory of an unpacked data release (manifest.json + shards). */
  catalogDir: string;
  /** config/forge/forge.json */
  configPath: string;
  /**
   * Only "fake" exists until the PoB worker pool is wired in. It must be
   * chosen explicitly so fantasy values never appear by accident.
   */
  calc: "fake";
  allowedOrigins: readonly string[];
  /** File with the per-installation access token (created if missing). */
  tokenFile: string;
  logger: Logger;
}

/** Loads config and catalog, opens the store and listens on 127.0.0.1. */
export async function startServer(
  options: StartOptions,
): Promise<{ app: FastifyInstance; store: RunStore; url: string }> {
  const config = await loadForgeConfig(options.configPath);
  const catalog = await loadCatalogRelease(options.catalogDir);
  const fake = new CalcFake({ dataReleaseId: catalog.dataReleaseId });
  options.logger.info("calc engine is calc-fake: values are not from Path of Building", {
    dataReleaseId: catalog.dataReleaseId,
  });
  const accessToken = await loadOrCreateAccessToken(options.tokenFile);
  const store = new RunStore(options.databasePath);
  const calc = new PersistedCalc(fake, store);
  const engine = new ForgeEngine({
    store,
    catalog,
    calc,
    config,
    pipelines: [createPocPipeline(config.pipelines.poc)],
    calcProfiles: config.pipelines.poc.calcProfiles,
  });
  const app = createApp({
    engine,
    catalog,
    calc,
    calcProfiles: config.pipelines.poc.calcProfiles,
    waitLongPollSeconds: config.waitLongPollSeconds,
    logger: options.logger,
    port: options.port,
    allowedOrigins: options.allowedOrigins,
    defaultPipelineId: "poc",
    accessToken,
  });
  app.addHook("onClose", async () => store.close());
  await app.listen({ host: LOOPBACK_HOST, port: options.port });
  const url = `http://${LOOPBACK_HOST}:${options.port}`;
  options.logger.info("listening", { url, mcp: `${url}/mcp`, tokenFile: options.tokenFile });
  return { app, store, url };
}
