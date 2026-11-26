import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import * as tar from "tar";
import { CatalogManifest } from "@astrolabe/contracts";
import { type FetchLike, type RemoteRelease } from "./list.js";
import { compareReleaseIds, parseReleaseId } from "./release-id.js";

export interface InstallOptions {
  fetch: FetchLike;
  release: RemoteRelease;
  /** Folder that holds one subfolder per installed release. */
  releasesDir: string;
  userAgent: string;
  /** Largest accepted download and unpacked size, in bytes (from config, not hard-coded). */
  maxDownloadBytes: number;
  maxUnpackedBytes: number;
  signal?: AbortSignal;
}

export class ReleaseInstallError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReleaseInstallError";
  }
}

const sha256Of = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

async function fetchOk(options: InstallOptions, url: string): Promise<Response> {
  let response: Response;
  try {
    response = await options.fetch(url, {
      headers: { "User-Agent": options.userAgent },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (cause) {
    throw new ReleaseInstallError(`Download of ${options.release.id} failed`, { cause });
  }
  if (!response.ok || response.body === null) {
    throw new ReleaseInstallError(`Download of ${options.release.id} answered ${response.status}`);
  }
  return response;
}

/** Streams the body to a file while hashing it; refuses to go beyond `limit` bytes. */
async function download(response: Response, file: string, limit: number): Promise<string> {
  const hash = createHash("sha256");
  let size = 0;
  const source = Readable.fromWeb(response.body as never);
  source.on("data", (chunk: Buffer) => {
    size += chunk.length;
    hash.update(chunk);
    if (size > limit)
      source.destroy(new ReleaseInstallError(`The download is larger than ${limit} bytes`));
  });
  await pipeline(source, createWriteStream(file));
  return hash.digest("hex");
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

/**
 * Installs a data release: download, SHA-256 against the published checksum, unpack only plain
 * files and folders into a temporary folder, verify manifest and shards, then move it into place
 * in one rename. An installed release is never overwritten. Returns the folder.
 */
export async function installRelease(
  options: InstallOptions,
): Promise<{ id: string; dir: string; alreadyInstalled: boolean }> {
  const { release, releasesDir } = options;
  parseReleaseId(release.id);
  const target = join(releasesDir, release.id);
  await mkdir(releasesDir, { recursive: true });
  try {
    await stat(join(target, "manifest.json"));
    return { id: release.id, dir: target, alreadyInstalled: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ReleaseInstallError(`Cannot inspect ${release.id}`, { cause: error });
    }
  }
  const work = join(releasesDir, `.installing-${randomUUID()}`);
  await mkdir(work);
  try {
    const checksumText = await (await fetchOk(options, release.checksumUrl)).text();
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
    let refused = false;
    await tar.extract({
      file: archive,
      cwd: unpacked,
      strict: true,
      // only plain files and folders: no links, devices or anything else
      filter: (_path, entry) => {
        const type = "type" in entry ? entry.type : undefined;
        if (type === "File" || type === "Directory") return true;
        refused = true;
        return false;
      },
    });
    if (refused) {
      throw new ReleaseInstallError("The archive holds something other than files and folders");
    }
    if ((await totalSize(unpacked)) > options.maxUnpackedBytes) {
      throw new ReleaseInstallError(
        `The unpacked release is larger than ${options.maxUnpackedBytes} bytes`,
      );
    }
    await verifyReleaseDir(unpacked, release.id);
    try {
      await rename(unpacked, target);
    } catch (cause) {
      throw new ReleaseInstallError(`Could not move ${release.id} into place`, { cause });
    }
    return { id: release.id, dir: target, alreadyInstalled: false };
  } finally {
    await rm(work, { recursive: true, force: true });
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

/** Removes folders of interrupted installs. */
export async function removeLeftovers(releasesDir: string): Promise<number> {
  let names: string[];
  try {
    names = await readdir(releasesDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw new ReleaseInstallError(`Cannot read ${releasesDir}`, { cause: error });
  }
  const stale = names.filter((n) => n.startsWith(".installing-"));
  await Promise.all(stale.map((n) => rm(join(releasesDir, n), { recursive: true, force: true })));
  return stale.length;
}
