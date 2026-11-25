import type { z } from "zod";
import type { HttpCache } from "./cache.js";
import type { EconomyConfig } from "./config.js";
import { EconomyError } from "./errors.js";
import { ExchangeOverviewResponse, LeaguesResponse } from "./provider.js";

export interface ClientDeps {
  config: EconomyConfig;
  /** Version shown in the User-Agent. */
  appVersion: string;
  http: HttpCache;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
}

/**
 * Client for the provider's public economy endpoints. Polite by construction:
 * identifying User-Agent without personal data, requests one after another with
 * a minimum interval, conditional requests (ETag), size and time limits.
 * Failures raise EconomyError; nothing is replaced by an empty list.
 */
export class PoeNinjaClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly clock: () => number;
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  /** Serialises requests, so the interval holds even for concurrent callers. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ClientDeps) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.clock = deps.clock ?? Date.now;
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

  private url(path: string): string {
    return new URL(
      path.replace("{game}", this.deps.config.game),
      this.deps.config.baseUrl,
    ).toString();
  }

  private getJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
    const run = this.queue.then(() => this.request(url, schema));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async request<T>(url: string, schema: z.ZodType<T>): Promise<T> {
    const { config } = this.deps;
    const wait = this.lastRequestAt + config.minRequestIntervalMs - this.clock();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = this.clock();

    const cached = await this.deps.http.get(url);
    const headers: Record<string, string> = {
      "User-Agent": config.userAgent.replace("{appVersion}", this.deps.appVersion),
      Accept: "application/json",
    };
    if (cached?.etag) headers["If-None-Match"] = cached.etag;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers,
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
    if (response.status === 304) {
      if (!cached) {
        throw new EconomyError("invalid_response", `304 without a cached copy for ${url}`);
      }
      body = cached.body;
    } else if (response.status === 429) {
      throw new EconomyError("rate_limited", `provider answered 429 for ${url}`);
    } else if (!response.ok) {
      throw new EconomyError("http_error", `provider answered ${response.status} for ${url}`);
    } else {
      body = await this.readLimited(response, url);
      const etag = response.headers.get("etag");
      await this.deps.http.set(url, {
        ...(etag ? { etag } : {}),
        body,
        storedAt: new Date(this.clock()).toISOString(),
      });
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
    return parsed.data;
  }

  private async readLimited(response: Response, url: string): Promise<string> {
    const max = this.deps.config.maxResponseBytes;
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > max) {
      throw new EconomyError(
        "response_too_large",
        `${url} announces ${declared} bytes, limit ${max}`,
      );
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > max) {
      throw new EconomyError("response_too_large", `${url} is larger than ${max} bytes`);
    }
    return text;
  }
}
