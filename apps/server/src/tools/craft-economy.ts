import { readFile } from "node:fs/promises";
import type { z } from "zod";
import type { BaseItem, CraftingAction, Mod, PriceBook, UniqueItem } from "@astrolabe/contracts";
import type { CraftSimRequest, CraftSimResult, EconomyTools } from "@astrolabe/contracts";
import {
  createSimCatalog,
  CraftSimInputError,
  parseCraftSimConfig,
  simulate,
} from "@astrolabe/crafting-sim";
import {
  EconomyError,
  EconomyService,
  FileBookStore,
  FileHttpCache,
  parseEconomyConfig,
  parseItemMap,
  PoeNinjaClient,
} from "@astrolabe/economy";
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

/**
 * Resolves the provider's unique item (name and base type name) to a catalog
 * unique by name and the name of its base item (the provider lists one line per
 * base). If the base differs from the catalog's, or several or no unique match,
 * the result is undefined and the line stays unmapped; without a base type only
 * a unique name resolves.
 */
export function createUniqueResolver(
  catalog: CatalogPort,
): (name: string, baseType: string | undefined) => string | undefined {
  const baseNames = new Map(
    catalog
      .list("baseItem")
      .map((e) => [String((e.entity as BaseItem).id), (e.entity as BaseItem).name]),
  );
  const byName = new Map<string, UniqueItem[]>();
  for (const e of catalog.list("uniqueItem")) {
    const unique = e.entity as UniqueItem;
    byName.set(unique.name, [...(byName.get(unique.name) ?? []), unique]);
  }
  return (name, baseType) => {
    const matches = byName.get(name) ?? [];
    // The provider lists one line per base type. A line whose base differs from the
    // catalog's (e.g. another base of the same name) is a different item: unmapped.
    const narrowed =
      baseType === undefined
        ? matches
        : matches.filter((u) => baseNames.get(String(u.baseItemId)) === baseType);
    return narrowed.length === 1 ? String(narrowed[0]?.id) : undefined;
  };
}

export interface PriceSource {
  price: EconomyPort;
  /** The league's price book for crafting costs, and whether it is older than a failed refresh allows. */
  book(league?: string): Promise<{ book: PriceBook; stale: boolean }>;
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
    resolveUnique: createUniqueResolver(catalog),
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
    rarities: catalog.release?.rarities?.rarities,
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
    // Without a league in the request the provider's current challenge league is used (the book
    // names it, so every cost carries the league it was priced in).
    if (economy !== undefined) {
      try {
        const result = await economy.book(request.league);
        if (result.stale && request.league === undefined) {
          // The current league could not be looked up, so the older book may be of a past league.
          logger.error("craft costs are uncalibrated: the current league could not be confirmed", {
            league: result.book.league,
            fetchedAt: result.book.fetchedAt,
          });
        } else {
          prices = result.book;
        }
        if (result.stale && prices !== undefined) {
          logger.error("craft cost uses an older price book because the refresh failed", {
            league: result.book.league,
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
