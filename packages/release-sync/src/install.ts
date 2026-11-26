import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import * as tar from "tar";
import { CatalogManifest } from "@astrolabe/contracts";
import { isOwnReleaseUrl, type FetchLike, type RemoteRelease } from "./list.js";
import { compareReleaseIds, parseReleaseId } from "./release-id.js";

export interface InstallOptions {
  fetch: FetchLike;
  release: RemoteRelease;
  /** "owner/name" the downloads must come from. */
  repo: string;
  /** Hosts a download may be redirected to (https only), e.g. GitHub's release CDN. */
  allowedRedirectHosts: readonly string[];
  /** Folder that holds one subfolder per installed release. */
  releasesDir: string;
  userAgent: string;
  /** All limits come from config, not from code. Sizes are bytes. */
  maxDownloadBytes: number;
  maxUnpackedBytes: number;
  maxChecksumBytes: number;
  /** Largest ratio of unpacked to packed size and most entries a catalog archive may have. */
  maxDecompressionRatio: number;
  maxEntries: number;
  signal?: AbortSignal;
}

export class ReleaseInstallError extends Error {
  /** Set when removing the temporary folder failed too (the install error is still the main one). */
  cleanupFailure?: unknown;
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReleaseInstallError";
  }
}

const sha256Of = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

const wrap = (error: unknown, message: string): ReleaseInstallError =>
  error instanceof ReleaseInstallError ? error : new ReleaseInstallError(message, { cause: error });

async function fetchOk(options: InstallOptions, url: string): Promise<Response> {
  const id = options.release.id;
  if (!isOwnReleaseUrl(url, options.repo)) {
    throw new ReleaseInstallError(
      `The download address of ${id} is not a release file of ${options.repo}`,
    );
  }
  let response: Response;
  try {
    response = await options.fetch(url, {
      headers: { "User-Agent": options.userAgent },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (cause) {
    throw new ReleaseInstallError(`Download of ${id} failed`, { cause });
  }
  // fetch follows redirects; where it ended up must still be https and a known host
  const finalUrl = new URL(response.url === "" ? url : response.url);
  if (finalUrl.protocol !== "https:" || !options.allowedRedirectHosts.includes(finalUrl.hostname)) {
    await response.body?.cancel();
    throw new ReleaseInstallError(
      `The download of ${id} was redirected to ${finalUrl.hostname}, which is not allowed`,
    );
  }
  if (!response.ok || response.body === null) {
    throw new ReleaseInstallError(`Download of ${id} answered ${response.status}`);
  }
  return response;
}

/** Streams the body to a file while hashing it; refuses to go beyond `limit` bytes. */
async function download(response: Response, file: string, limit: number): Promise<string> {
  const hash = createHash("sha256");
  let size = 0;
  // the body of a fetch Response is a web stream; Node's types want their own spelling of it
  const source = Readable.fromWeb(response.body as unknown as NodeWebStream);
  source.on("data", (chunk: Buffer) => {
    size += chunk.length;
    hash.update(chunk);
    if (size > limit)
      source.destroy(new ReleaseInstallError(`The download is larger than ${limit} bytes`));
  });
  await pipeline(source, createWriteStream(file));
  return hash.digest("hex");
}

/** Reads a small text body, refusing more than `limit` bytes. */
async function readSmallText(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new ReleaseInstallError(`The checksum file is larger than ${limit} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function totalSize(dir: string): Promise<number> {
  let sum = 0;
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) sum += (await stat(join(entry.parentPath, entry.name))).size;
  }
  return sum;
}

/** Reads manifest and shards of an unpacked release and checks ids and shard hashes. */
export async function verifyReleaseDir(dir: string, expectedId: string): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  } catch (cause) {
    throw new ReleaseInstallError("The data release has no readable manifest.json", { cause });
  }
  const manifest = CatalogManifest.safeParse(raw);
  if (!manifest.success) {
    throw new ReleaseInstallError("The manifest of the data release does not match the contract");
  }
  if (manifest.data.release.id !== expectedId) {
    throw new ReleaseInstallError(
      `The release names itself ${manifest.data.release.id}, expected ${expectedId}`,
    );
  }
  for (const shard of manifest.data.shards) {
    const path = resolve(dir, shard.path);
    if (relative(resolve(dir), path).startsWith("..")) {
      throw new ReleaseInstallError(`Shard ${shard.kind} points outside the release`);
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (cause) {
      throw new ReleaseInstallError(`Shard ${shard.kind} is missing`, { cause });
    }
    if (sha256Of(bytes) !== shard.sha256) {
      throw new ReleaseInstallError(`Shard ${shard.kind} does not match its hash`);
    }
  }
}

/** Failures of a rename that mean "someone else got there first or the file is briefly locked". */
const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_ATTEMPTS = 4;
const RENAME_BACKOFF_MS = 250;

const hasManifest = async (dir: string): Promise<boolean> => {
  try {
    await stat(join(dir, "manifest.json"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new ReleaseInstallError(`Cannot inspect ${dir}`, { cause: error });
  }
};

async function moveIntoPlace(from: string, target: string, id: string): Promise<boolean> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, target);
      return true;
    } catch (error) {
      // another install of the same release finished first: fine, never overwrite
      if (await hasManifest(target)) return false;
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!RENAME_RETRY_CODES.has(code) || attempt >= RENAME_ATTEMPTS) {
        throw new ReleaseInstallError(`Could not move ${id} into place`, { cause: error });
      }
      // a virus scanner may still hold the freshly written files (Windows)
      await new Promise((r) => setTimeout(r, RENAME_BACKOFF_MS * attempt));
    }
  }
}

/**
 * Installs a data release: download, SHA-256 against the published checksum, unpack only plain
 * files and folders (within the size, ratio and entry limits) into a temporary folder, verify
 * manifest and shards, then move it into place in one rename. An installed release is never
 * overwritten. Returns the folder.
 */
export async function installRelease(
  options: InstallOptions,
): Promise<{ id: string; dir: string; alreadyInstalled: boolean; cleanupFailure?: unknown }> {
  const { release, releasesDir } = options;
  parseReleaseId(release.id);
  if (release.catalogSize > options.maxDownloadBytes) {
    throw new ReleaseInstallError(
      `${release.id} is larger than the allowed ${options.maxDownloadBytes} bytes`,
    );
  }
  const target = join(releasesDir, release.id);
  await mkdir(releasesDir, { recursive: true });
  if (await hasManifest(target)) return { id: release.id, dir: target, alreadyInstalled: true };
  try {
    await stat(target);
    throw new ReleaseInstallError(
      `${target} exists but holds no release; remove that folder to install ${release.id}`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw wrap(error, `Cannot inspect ${target}`);
  }
  const work = join(releasesDir, `.installing-${randomUUID()}`);
  await mkdir(work);
  try {
    const checksumText = await readSmallText(
      await fetchOk(options, release.checksumUrl),
      options.maxChecksumBytes,
    );
    const expected = /^([0-9a-f]{64})\s/.exec(`${checksumText.trim()} `)?.[1];
    if (expected === undefined)
      throw new ReleaseInstallError("The checksum file is not a SHA-256 line");
    const archive = join(work, "catalog.tar.gz");
    const actual = await download(
      await fetchOk(options, release.catalogUrl),
      archive,
      options.maxDownloadBytes,
    );
    if (actual !== expected) {
      throw new ReleaseInstallError(`The download of ${release.id} does not match its checksum`);
    }
    const unpacked = join(work, "unpacked");
    await mkdir(unpacked);
    let refused: string | undefined;
    let bytes = 0;
    let entries = 0;
    await tar
      .extract({
        file: archive,
        cwd: unpacked,
        strict: true,
        maxDecompressionRatio: options.maxDecompressionRatio,
        // only plain files and folders, within the limits; nothing past a limit is written
        filter: (_path, entry) => {
          if (refused !== undefined) return false;
          const type = "type" in entry ? entry.type : undefined;
          entries += 1;
          bytes += "size" in entry && typeof entry.size === "number" ? entry.size : 0;
          if (type !== "File" && type !== "Directory") {
            refused = "The archive holds something other than files and folders";
          } else if (entries > options.maxEntries) {
            refused = `The archive has more than ${options.maxEntries} entries`;
          } else if (bytes > options.maxUnpackedBytes) {
            refused = `The unpacked release is larger than ${options.maxUnpackedBytes} bytes`;
          }
          return refused === undefined;
        },
      })
      .catch((cause: unknown) => {
        throw new ReleaseInstallError(`Could not unpack ${release.id}`, { cause });
      });
    if (refused !== undefined) throw new ReleaseInstallError(refused);
    if ((await totalSize(unpacked)) > options.maxUnpackedBytes) {
      throw new ReleaseInstallError(
        `The unpacked release is larger than ${options.maxUnpackedBytes} bytes`,
      );
    }
    await verifyReleaseDir(unpacked, release.id);
    const moved = await moveIntoPlace(unpacked, target, release.id);
    // the release is in place; a temporary folder that stays behind is reported, not fatal
    const cleanupFailure = await removeWork(work);
    return {
      id: release.id,
      dir: target,
      alreadyInstalled: !moved,
      ...(cleanupFailure === undefined ? {} : { cleanupFailure }),
    };
  } catch (error) {
    const failure = wrap(error, `Installing ${release.id} failed`);
    // never hide the real error behind a cleanup problem
    failure.cleanupFailure = await removeWork(work);
    throw failure;
  }
}

/** Removes the temporary folder; returns the problem instead of throwing it. */
async function removeWork(work: string): Promise<unknown> {
  try {
    await rm(work, { recursive: true, force: true, maxRetries: 3, retryDelay: RENAME_BACKOFF_MS });
    return undefined;
  } catch (error) {
    return error;
  }
}

/** Ids of the releases in the folder that have a manifest, oldest first. Foreign names are ignored. */
export async function installedReleaseIds(releasesDir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(releasesDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new ReleaseInstallError(`Cannot read ${releasesDir}`, { cause: error });
  }
  const ids: string[] = [];
  for (const name of names) {
    try {
      parseReleaseId(name);
    } catch {
      continue; // temporary folders and foreign files
    }
    try {
      await stat(join(releasesDir, name, "manifest.json"));
      ids.push(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new ReleaseInstallError(`Cannot inspect ${name}`, { cause: error });
      }
    }
  }
  return ids.sort(compareReleaseIds);
}

/**
 * Removes temporary folders of interrupted installs that are older than `minAgeMs`, so an
 * install that is running right now (this or a second app instance) is left alone.
 */
export async function removeLeftovers(releasesDir: string, minAgeMs: number): Promise<number> {
  let names: string[];
  try {
    names = await readdir(releasesDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw new ReleaseInstallError(`Cannot read ${releasesDir}`, { cause: error });
  }
  let removed = 0;
  for (const name of names.filter((n) => n.startsWith(".installing-"))) {
    const dir = join(releasesDir, name);
    if (Date.now() - (await stat(dir)).mtimeMs < minAgeMs) continue;
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: RENAME_BACKOFF_MS });
    removed += 1;
  }
  return removed;
}
