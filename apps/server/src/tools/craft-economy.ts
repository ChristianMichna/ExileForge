import { readFile } from "node:fs/promises";
import type { z } from "zod";
import type { BaseItem, CraftingAction, Mod, PriceBook } from "@exileforge/contracts";
import type { CraftSimRequest, CraftSimResult, EconomyTools } from "@exileforge/contracts";
import {
  createSimCatalog,
  CraftSimInputError,
  parseCraftSimConfig,
  simulate,
} from "@exileforge/crafting-sim";
import {
  EconomyError,
  EconomyService,
  FileBookStore,
  FileHttpCache,
  parseEconomyConfig,
  parseItemMap,
  PoeNinjaClient,
} from "@exileforge/economy";
import { ForgeError } from "../engine/errors.js";
import type { Logger } from "../logger.js";
import type { CatalogPort } from "../ports/catalog.js";

type PriceInput = z.infer<(typeof EconomyTools)["economy.price"]["input"]>;
type PriceOutput = z.infer<(typeof EconomyTools)["economy.price"]["output"]>;

/** craft.simulate as the MCP tool uses it. */
export type CraftPort = (request: CraftSimRequest) => Promise<CraftSimResult>;
/** economy.price as the MCP tool uses it. */
export type EconomyPort = (input: PriceInput) => Promise<PriceOutput>;

export interface EconomySettings {
  /** config/economy/economy.json */
  configPath: string;
  /** config/economy/item-map.json */
  itemMapPath: string;
  /** Directory for the HTTP cache and the price books. */
  cacheDir: string;
  appVersion: string;
}

async function readJson(path: string, what: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (cause) {
    throw new Error(`Cannot read ${what} ${path}`, { cause });
  }
}

export interface PriceSource {
  price: EconomyPort;
  /** The league's price book for crafting costs, and whether it is older than a failed refresh allows. */
  book(league: string): Promise<{ book: PriceBook; stale: boolean }>;
}

/** Builds the market price service from config; prices come only from the provider, never from code. */
export async function createEconomy(
  settings: EconomySettings,
  catalog: CatalogPort,
  logger: Logger,
): Promise<PriceSource> {
  const config = parseEconomyConfig(await readJson(settings.configPath, "economy config"));
  const itemMap = parseItemMap(await readJson(settings.itemMapPath, "economy item map"));
  const warn = (message: string, cause?: unknown) =>
    logger.error(`economy: ${message}`, cause === undefined ? {} : { error: cause });
  const service = new EconomyService({
    config,
    itemMap,
    client: new PoeNinjaClient({
      config,
      appVersion: settings.appVersion,
      http: new FileHttpCache(settings.cacheDir, warn),
      onWarn: warn,
    }),
    books: new FileBookStore(settings.cacheDir, warn),
    dataReleaseId: catalog.dataReleaseId,
    catalogHas: (kind, id) => catalog.get({ kind, id }) !== undefined,
  });
  const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof EconomyError) {
        throw new ForgeError("economy_failed", `${error.code}: ${error.message}`);
      }
      throw error;
    }
  };
  return {
    price: (input) => wrap(() => service.price(input)),
    book: (league) =>
      wrap(async () => {
        const result = await service.getBook(league);
        return { book: result.book, stale: result.freshness === "stale" };
      }),
  };
}

/** Builds craft.simulate on the loaded data release; costs use the league's price book when an economy exists. */
export async function createCraft(
  configPath: string,
  catalog: CatalogPort,
  economy: PriceSource | undefined,
  logger: Logger,
): Promise<CraftPort> {
  const config = parseCraftSimConfig(await readJson(configPath, "craft sim config"));
  const entities = <T>(kind: "baseItem" | "mod" | "craftingAction"): T[] =>
    catalog.list(kind).map((e) => e.entity as T);
  const simCatalog = createSimCatalog({
    baseItems: entities<BaseItem>("baseItem"),
    mods: entities<Mod>("mod"),
    actions: entities<CraftingAction>("craftingAction"),
  });
  return async (request) => {
    if (request.dataReleaseId !== catalog.dataReleaseId) {
      throw new ForgeError(
        "invalid_request",
        `Request targets data release ${request.dataReleaseId}, the loaded catalog is ${catalog.dataReleaseId}`,
      );
    }
    // Without a usable price book the simulation still runs; its costs are then "uncalibrated".
    let prices: PriceBook | undefined;
    if (request.league !== undefined && economy !== undefined) {
      try {
        const result = await economy.book(request.league);
        prices = result.book;
        if (result.stale) {
          logger.error("craft cost uses an older price book because the refresh failed", {
            league: request.league,
            fetchedAt: result.book.fetchedAt,
          });
        }
      } catch (error) {
        logger.error("craft costs are uncalibrated: no price book", { error });
      }
    }
    try {
      return simulate(request, { catalog: simCatalog, config, prices });
    } catch (error) {
      if (error instanceof CraftSimInputError) {
        throw new ForgeError("invalid_request", error.message);
      }
      throw error;
    }
  };
}
