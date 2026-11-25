import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { PriceBook } from "@exileforge/contracts";
import { EconomyError } from "./errors.js";

/** Cache files larger than this are ignored; a response is limited far below it. */
const MAX_CACHE_FILE_BYTES = 20_000_000;

/** Stored response of one URL, for conditional requests (ETag) and 304 answers. */
export const HttpCacheEntry = z.object({
  etag: z.string().min(1).optional(),
  body: z.string().max(MAX_CACHE_FILE_BYTES),
  storedAt: z.iso.datetime({ offset: true }),
});
export type HttpCacheEntry = z.infer<typeof HttpCacheEntry>;

export interface HttpCache {
  get(url: string): Promise<HttpCacheEntry | undefined>;
  set(url: string, entry: HttpCacheEntry): Promise<void>;
}

/** Last price book per league and data release. */
export interface BookStore {
  get(league: string, dataReleaseId: string): Promise<PriceBook | undefined>;
  /** The book stored last for this release, whatever its league. */
  latest(dataReleaseId: string): Promise<PriceBook | undefined>;
  set(book: PriceBook): Promise<void>;
}

type Warn = (message: string, cause?: unknown) => void;

const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** Writes through a temp file so a crash never leaves half a JSON file. */
async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, content, { encoding: "utf8", flag: "wx" });
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw new EconomyError("cache_error", `cannot write cache file ${path}`, { cause: error });
  }
}

async function readJson(path: string, onWarn: Warn): Promise<unknown> {
  let text: string;
  try {
    if ((await stat(path)).size > MAX_CACHE_FILE_BYTES) {
      onWarn(`ignoring oversized cache file ${path}`);
      return undefined;
    }
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new EconomyError("cache_error", `cannot read cache file ${path}`, { cause: error });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    // A broken cache file is a cache miss, but not a silent one.
    onWarn(`ignoring unreadable cache file ${path}`, error);
    return undefined;
  }
}

async function readValidated<T>(
  path: string,
  schema: z.ZodType<T>,
  onWarn: Warn,
): Promise<T | undefined> {
  const raw = await readJson(path, onWarn);
  if (raw === undefined) return undefined;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    onWarn(`ignoring invalid cache file ${path}`, parsed.error);
    return undefined;
  }
  return parsed.data;
}

export class FileHttpCache implements HttpCache {
  constructor(
    private readonly dir: string,
    private readonly onWarn: Warn,
  ) {}

  private path(url: string): string {
    return join(this.dir, `http-${digest(url)}.json`);
  }

  get(url: string): Promise<HttpCacheEntry | undefined> {
    return readValidated(this.path(url), HttpCacheEntry, this.onWarn);
  }

  async set(url: string, entry: HttpCacheEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeAtomic(this.path(url), JSON.stringify(entry));
  }
}

export class FileBookStore implements BookStore {
  constructor(
    private readonly dir: string,
    private readonly onWarn: Warn,
  ) {}

  private path(league: string, dataReleaseId: string): string {
    return join(this.dir, `book-${digest(`${league}\n${dataReleaseId}`)}.json`);
  }

  get(league: string, dataReleaseId: string): Promise<PriceBook | undefined> {
    return readValidated(this.path(league, dataReleaseId), PriceBook, this.onWarn);
  }

  private latestPath(dataReleaseId: string): string {
    return join(this.dir, `latest-${digest(dataReleaseId)}.json`);
  }

  async latest(dataReleaseId: string): Promise<PriceBook | undefined> {
    const pointer = await readValidated(
      this.latestPath(dataReleaseId),
      z.object({ league: z.string().min(1) }),
      this.onWarn,
    );
    return pointer ? this.get(pointer.league, dataReleaseId) : undefined;
  }

  async set(book: PriceBook): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeAtomic(this.path(book.league, book.dataReleaseId), JSON.stringify(book));
    await writeAtomic(this.latestPath(book.dataReleaseId), JSON.stringify({ league: book.league }));
  }
}
