import type { z } from "zod";
import type { HttpCache } from "./cache.js";
import type { EconomyConfig } from "./config.js";
import { EconomyError } from "./errors.js";
import { ExchangeOverviewResponse, LeaguesResponse, UniqueOverviewResponse } from "./provider.js";

export interface ClientDeps {
  config: EconomyConfig;
  /** Version shown in the User-Agent. */
  appVersion: string;
  http: HttpCache;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  /** Receives problems that do not stop a request (e.g. an unwritable HTTP cache). */
  onWarn?: (message: string, cause?: unknown) => void;
}

/**
 * Client for the provider's public economy endpoints. Polite by construction:
 * identifying User-Agent with the contact chosen by the project owner, requests one after another with
 * a minimum interval, conditional requests (ETag), size and time limits, no
 * redirects, a pause after 429. Failures raise EconomyError; nothing is
 * replaced by an empty list.
 */
export class PoeNinjaClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly clock: () => number;
  private readonly warn: (message: string, cause?: unknown) => void;
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  /** After a 429 nothing is sent before this time (clock ms). */
  private blockedUntil = Number.NEGATIVE_INFINITY;
  /** Serialises requests, so the interval holds even for concurrent callers. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ClientDeps) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.clock = deps.clock ?? Date.now;
    this.warn = deps.onWarn ?? (() => undefined);
  }

  leagues(): Promise<z.infer<typeof LeaguesResponse>> {
    return this.getJson(this.url(this.deps.config.paths.leagues), LeaguesResponse);
  }

  exchangeOverview(league: string, type: string): Promise<ExchangeOverviewResponse> {
    const url = new URL(this.url(this.deps.config.paths.exchangeOverview));
    url.searchParams.set("league", league);
    url.searchParams.set("type", type);
    return this.getJson(url.toString(), ExchangeOverviewResponse);
  }

  uniqueOverview(league: string, type: string): Promise<UniqueOverviewResponse> {
    const path = this.deps.config.paths.uniqueOverview;
    if (path === undefined) {
      throw new EconomyError("invalid_response", "paths.uniqueOverview is not configured");
    }
    const url = new URL(this.url(path));
    url.searchParams.set("league", league);
    url.searchParams.set("type", type);
    return this.getJson(url.toString(), UniqueOverviewResponse);
  }

  private url(path: string): string {
    const base = new URL(this.deps.config.baseUrl);
    const url = new URL(path.replace("{game}", this.deps.config.game), base);
    // Paths come from config; still never leave the configured origin.
    if (url.origin !== base.origin) {
      throw new EconomyError("invalid_response", `request URL ${url.origin} is not ${base.origin}`);
    }
    return url.toString();
  }

  private getJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
    const run = this.queue.then(() => this.request(url, schema));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async cacheGet(url: string) {
    try {
      return await this.deps.http.get(url);
    } catch (error) {
      this.warn(`HTTP cache unreadable for ${url}; fetching without it`, error);
      return undefined;
    }
  }

  private async cacheSet(url: string, entry: Parameters<HttpCache["set"]>[1]) {
    try {
      await this.deps.http.set(url, entry);
    } catch (error) {
      this.warn(`HTTP cache not writable for ${url}`, error);
    }
  }

  private async request<T>(url: string, schema: z.ZodType<T>): Promise<T> {
    const { config } = this.deps;
    if (this.clock() < this.blockedUntil) {
      throw new EconomyError(
        "rate_limited",
        `not asking before ${new Date(this.blockedUntil).toISOString()}: the provider asked us to slow down`,
      );
    }
    const wait = this.lastRequestAt + config.minRequestIntervalMs - this.clock();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = this.clock();

    const cached = await this.cacheGet(url);
    const headers: Record<string, string> = {
      "User-Agent": config.userAgent
        .replaceAll("{appName}", config.appName)
        .replaceAll("{appVersion}", this.deps.appVersion),
      Accept: "application/json",
    };
    if (cached?.etag) headers["If-None-Match"] = cached.etag;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers,
        // A redirect could leave the configured host or https: an error, never followed.
        redirect: "manual",
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new EconomyError(
        timedOut ? "timeout" : "network_error",
        `${timedOut ? "timeout" : "network error"} requesting ${url}`,
        { cause: error },
      );
    }

    let body: string;
    let etag: string | null = null;
    const fromCache = response.status === 304;
    if (fromCache) {
      if (!cached) {
        throw new EconomyError("invalid_response", `304 without a cached copy for ${url}`);
      }
      body = cached.body;
    } else if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      const backoffMs = Math.min(
        Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : config.rateLimitBackoffMs,
        config.maxRateLimitBackoffMs,
      );
      this.blockedUntil = this.clock() + backoffMs;
      throw new EconomyError("rate_limited", `provider answered 429 for ${url}`);
    } else if (response.status >= 300 && response.status < 400) {
      throw new EconomyError(
        "http_error",
        `provider redirected ${url} (${response.status}); redirects are not followed`,
      );
    } else if (!response.ok) {
      throw new EconomyError("http_error", `provider answered ${response.status} for ${url}`);
    } else {
      body = await this.readLimited(response, url);
      etag = response.headers.get("etag");
    }

    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch (error) {
      throw new EconomyError("invalid_response", `response of ${url} is not JSON`, {
        cause: error,
      });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new EconomyError("invalid_response", `response of ${url} has an unexpected shape`, {
        cause: parsed.error,
      });
    }
    // Only a valid response is stored, so a bad body is never revalidated into permanence.
    if (!fromCache) {
      await this.cacheSet(url, {
        ...(etag ? { etag } : {}),
        body,
        storedAt: new Date(this.clock()).toISOString(),
      });
    }
    return parsed.data;
  }

  private async readLimited(response: Response, url: string): Promise<string> {
    const max = this.deps.config.maxResponseBytes;
    const header = response.headers.get("content-length");
    const declared = header === null ? Number.NaN : Number(header);
    if (Number.isFinite(declared) && declared > max) {
      throw new EconomyError(
        "response_too_large",
        `${url} announces ${declared} bytes, limit ${max}`,
      );
    }
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (error) {
        throw new EconomyError("network_error", `reading the response of ${url} failed`, {
          cause: error,
        });
      }
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        throw new EconomyError("response_too_large", `${url} is larger than ${max} bytes`);
      }
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
}
