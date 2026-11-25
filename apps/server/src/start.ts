import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { parseOptimizerConfig } from "@exileforge/optimizer";
import { createForgePipeline, StageConfig } from "@exileforge/agents";
import { loadOrCreateAccessToken } from "./access-token.js";
import { CalcFake } from "./calc/calc-fake.js";
import { ClassBaseBuilds, type BaseBuildSource } from "./calc/base-builds.js";
import { PersistedCalc } from "./calc/persisted-calc.js";
import { PobCalc, type CalcRequester } from "./calc/pob-calc.js";
import { createItemRenderer } from "./calc/item-text.js";
import { PobSkeleton } from "./calc/skeleton.js";
import type { CalcPort } from "./ports/calc.js";
import { loadCatalogRelease } from "./catalog/memory-catalog.js";
import { loadForgeConfig } from "./config/forge-config.js";
import { ForgeEngine } from "./engine/forge-engine.js";
import { createApp, LOOPBACK_HOST } from "./http/app.js";
import type { Logger } from "./logger.js";
import { createPocPipeline } from "./pipelines/poc-pipeline.js";
import { RunStore } from "./store/run-store.js";

/** The PoB worker pool as the server uses it (`CalcPool` from apps/calc fits). */
export type PobPool = CalcRequester & BaseBuildSource;

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
  /** config/agents/stages.json (settings of the planning stages) */
  stagesConfigPath: string;
  /**
   * "fake" (calc-fake: fantasy values, only for logic tests) must be chosen
   * explicitly so such values never appear by accident. The real engine is
   * the PoB worker pool the caller starts (apps/calc `startCalcPool`); with it
   * the real pipeline "forge" is the default and S3 measures skeleton builds.
   */
  calc: "fake" | { engine: "pob"; pool: PobPool; optimizerConfigPath: string };
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
  const stages = await loadStageConfig(options.stagesConfigPath);
  const catalog = await loadCatalogRelease(options.catalogDir);
  const accessToken = await loadOrCreateAccessToken(options.tokenFile);
  const store = new RunStore(options.databasePath);
  let calc: CalcPort;
  let pobCalc: PobCalc | undefined;
  let skeleton: PobSkeleton | undefined;
  if (options.calc === "fake") {
    options.logger.info("calc engine is calc-fake: values are not from Path of Building", {
      dataReleaseId: catalog.dataReleaseId,
    });
    calc = new PersistedCalc(new CalcFake({ dataReleaseId: catalog.dataReleaseId }), store);
  } else {
    const { pool, optimizerConfigPath } = options.calc;
    pobCalc = new PobCalc({
      pool,
      bases: new ClassBaseBuilds(pool),
      renderItem: createItemRenderer(catalog),
      logger: options.logger,
    });
    calc = new PersistedCalc(pobCalc, store);
    skeleton = new PobSkeleton({
      pob: pobCalc,
      pool,
      calc,
      catalog,
      optimizerConfig: await loadOptimizerConfig(optimizerConfigPath),
      settings: stages.s3,
      logger: options.logger,
    });
  }
  const engine = new ForgeEngine({
    store,
    catalog,
    calc,
    config,
    logger: options.logger,
    ...(skeleton === undefined ? {} : { skeleton }),
    pipelines: [createPocPipeline(config.pipelines.poc), createForgePipeline(stages)],
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
    defaultPipelineId: pobCalc === undefined ? "poc" : "forge",
    accessToken,
  });
  app.addHook("onClose", async () => {
    await pobCalc?.close();
    store.close();
  });
  await app.listen({ host: LOOPBACK_HOST, port: options.port });
  const url = `http://${LOOPBACK_HOST}:${options.port}`;
  options.logger.info("listening", { url, mcp: `${url}/mcp`, tokenFile: options.tokenFile });
  return { app, store, url };
}

async function loadStageConfig(path: string): Promise<StageConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read stage config ${path}`, { cause: error });
  }
  const parsed = StageConfig.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid stage config ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function loadOptimizerConfig(path: string): Promise<ReturnType<typeof parseOptimizerConfig>> {
  try {
    return parseOptimizerConfig(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    throw new Error(`Cannot read optimizer config ${path}`, { cause: error });
  }
}
