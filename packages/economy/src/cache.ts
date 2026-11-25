import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { PriceBook } from "@exileforge/contracts";

/** Stored response of one URL, for conditional requests (ETag) and 304 answers. */
export const HttpCacheEntry = z.object({
  etag: z.string().min(1).optional(),
  body: z.string(),
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
  set(book: PriceBook): Promise<void>;
}

type Warn = (message: string, cause?: unknown) => void;

const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** Writes through a temp file so a crash never leaves half a JSON file. */
async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

async function readJson(path: string, onWarn: Warn): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`cannot read cache file ${path}`, { cause: error });
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

  async set(book: PriceBook): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeAtomic(this.path(book.league, book.dataReleaseId), JSON.stringify(book));
  }
}
