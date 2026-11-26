import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import { describe, expect, it } from "vitest";
import {
  compareReleaseIds,
  installRelease,
  installedReleaseIds,
  isOwnReleaseUrl,
  listRemoteReleases,
  pickNewRelease,
  releaseIdOfTag,
  removeLeftovers,
  tagOf,
  type FetchLike,
  type RemoteRelease,
} from "../src/index.js";

const REPO = "owner/astrolabe";
const UA = "Astrolabe/test (+https://github.com/owner/astrolabe)";
const ID = "poe2-9.8.8+r1";
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

const tmp = () => mkdtempSync(join(tmpdir(), "astrolabe-sync-"));

/** Builds a catalog folder and packs it; `mutate` lets a test damage it before packing. */
async function pack(id = ID, mutate?: (dir: string) => void): Promise<Buffer> {
  const dir = tmp();
  const shard = JSON.stringify({ entities: [] });
  mkdirSync(join(dir, "shards"));
  writeFileSync(join(dir, "shards", "gem.json"), shard);
  const [, version, rev] = /^poe2-(.+)\+r(\d+)$/.exec(id) ?? [];
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      release: {
        id,
        gameVersion: version,
        pobVersion: "v9.9.9",
        pipelineRevision: Number(rev),
        sourceHashes: {},
        createdAt: "2026-01-01T00:00:00Z",
      },
      shards: [{ kind: "gem", path: "shards/gem.json", sha256: sha(shard), count: 0 }],
    }),
  );
  mutate?.(dir);
  const file = join(tmp(), "c.tar.gz");
  await tar.create({ gzip: true, file, cwd: dir }, ["."]);
  return readFileSync(file);
}

function remote(id: string, extra: Partial<RemoteRelease> = {}): RemoteRelease {
  const base = `https://github.com/${REPO}/releases/download/${tagOf(id)}/catalog-${id.replace("+", "-")}.tar.gz`;
  return {
    id,
    tag: tagOf(id),
    prerelease: false,
    publishedAt: "2026-01-01T00:00:00Z",
    catalogUrl: base,
    checksumUrl: `${base}.sha256`,
    catalogSize: 1,
    ...extra,
  };
}

function serve(archive: Buffer, checksum = sha(archive)): FetchLike {
  return async (url) =>
    url.endsWith(".sha256")
      ? new Response(`${checksum}  file.tar.gz\n`)
      : new Response(new Uint8Array(archive));
}

const limits = { maxDownloadBytes: 10_000_000, maxUnpackedBytes: 10_000_000 };
const install = (releasesDir: string, fetch: FetchLike, release = remote(ID), extra = {}) =>
  installRelease({ fetch, release, releasesDir, userAgent: UA, ...limits, ...extra });

describe("release ids", () => {
  it("orders numerically, converts tags both ways and rejects foreign tags", () => {
    expect(compareReleaseIds("poe2-0.5.10.1+r1", "poe2-0.5.9.9+r5")).toBeGreaterThan(0);
    expect(compareReleaseIds("poe2-1.0.0+r2", "poe2-1.0.0.0+r1")).toBeGreaterThan(0);
    expect(compareReleaseIds("poe2-1.0.0+r1", "poe2-1.0.0+r2")).toBeLessThan(0);
    expect(tagOf(ID)).toBe("data-poe2-9.8.8-r1");
    expect(releaseIdOfTag("data-poe2-9.8.8-r1")).toBe(ID);
    expect(releaseIdOfTag("v1.2.3")).toBeUndefined();
    expect(releaseIdOfTag("data-poe2-9.8.8-r01x")).toBeUndefined();
  });
});

describe("listRemoteReleases", () => {
  const asset = (name: string, host = "github.com", repo = REPO, tag = "data-poe2-9.8.8-r1") => ({
    name,
    size: 5,
    browser_download_url: `https://${host}/${repo}/releases/download/${tag}/${name}`,
  });
  const release = (tag: string, id: string, extra: object = {}) => ({
    tag_name: tag,
    draft: false,
    prerelease: true,
    published_at: "2026-11-26T00:00:00Z",
    assets: [
      asset(`catalog-${id}.tar.gz`, "github.com", REPO, tag),
      asset(`catalog-${id}.tar.gz.sha256`, "github.com", REPO, tag),
    ],
    ...extra,
  });
  const listFetch =
    (body: unknown, status = 200): FetchLike =>
    async () =>
      new Response(JSON.stringify(body), { status });

  it("returns data releases newest first and skips drafts, foreign tags and bad assets", async () => {
    const body = [
      release("data-poe2-9.8.8-r1", "poe2-9.8.8-r1"),
      release("data-poe2-9.9.0-r1", "poe2-9.9.0-r1"),
      release("v1.0.0", "x"),
      release("data-poe2-9.7.0-r1", "poe2-9.7.0-r1", { draft: true }),
      release("data-poe2-9.6.0-r1", "poe2-9.6.0-r1", { assets: [] }),
      release("data-poe2-9.5.0-r1", "poe2-9.5.0-r1", {
        assets: [
          asset("catalog-poe2-9.5.0-r1.tar.gz", "evil.example", REPO, "data-poe2-9.5.0-r1"),
          asset("catalog-poe2-9.5.0-r1.tar.gz.sha256", "github.com", REPO, "data-poe2-9.5.0-r1"),
        ],
      }),
    ];
    const list = await listRemoteReleases({ fetch: listFetch(body), repo: REPO, userAgent: UA });
    expect(list.map((r) => r.id)).toEqual(["poe2-9.9.0+r1", "poe2-9.8.8+r1"]);
  });
  it("fails loudly instead of returning an empty list", async () => {
    await expect(
      listRemoteReleases({ fetch: listFetch({}, 403), repo: REPO, userAgent: UA }),
    ).rejects.toThrow(/403/);
    await expect(
      listRemoteReleases({ fetch: listFetch({ nope: 1 }), repo: REPO, userAgent: UA }),
    ).rejects.toThrow(/unexpected shape/);
    await expect(
      listRemoteReleases({
        fetch: async () => {
          throw new Error("offline");
        },
        repo: REPO,
        userAgent: UA,
      }),
    ).rejects.toThrow(/Could not reach/);
    await expect(
      listRemoteReleases({ fetch: listFetch([]), repo: "../x", userAgent: UA }),
    ).rejects.toThrow(/Invalid repository/);
  });
  it("sends the identifiable user agent", async () => {
    let seen: string | undefined;
    await listRemoteReleases({
      fetch: async (_u, init) => {
        seen = init?.headers?.["User-Agent"];
        return new Response("[]");
      },
      repo: REPO,
      userAgent: UA,
    });
    expect(seen).toBe(UA);
  });
  it("accepts only download links of its own repository", () => {
    expect(isOwnReleaseUrl(`https://github.com/${REPO}/releases/download/t/f`, REPO)).toBe(true);
    expect(isOwnReleaseUrl(`http://github.com/${REPO}/releases/download/t/f`, REPO)).toBe(false);
    expect(isOwnReleaseUrl(`https://github.com/other/x/releases/download/t/f`, REPO)).toBe(false);
  });
});

describe("pickNewRelease", () => {
  const list = [remote("poe2-9.9.0+r1", { prerelease: true }), remote("poe2-9.8.8+r1")];
  it("finds a newer release, honours pre-releases and says nothing when up to date", () => {
    expect(pickNewRelease(list, ["poe2-9.8.0+r1"], { includePrereleases: true })?.id).toBe(
      "poe2-9.9.0+r1",
    );
    expect(pickNewRelease(list, ["poe2-9.8.0+r1"], { includePrereleases: false })?.id).toBe(
      "poe2-9.8.8+r1",
    );
    expect(pickNewRelease(list, ["poe2-9.9.0+r1"], { includePrereleases: true })).toBeUndefined();
    expect(pickNewRelease(list, [], { includePrereleases: true })?.id).toBe("poe2-9.9.0+r1");
  });
});

describe("installRelease", () => {
  it("installs a verified release and does not overwrite it later", async () => {
    const dir = tmp();
    const result = await install(dir, serve(await pack()));
    expect(result).toMatchObject({ id: ID, alreadyInstalled: false });
    expect(existsSync(join(dir, ID, "manifest.json"))).toBe(true);
    expect(await installedReleaseIds(dir)).toEqual([ID]);
    const again = await install(dir, async () => {
      throw new Error("must not download");
    });
    expect(again.alreadyInstalled).toBe(true);
    expect(await installedReleaseIds(join(dir, "missing"))).toEqual([]);
  });
  it("refuses a checksum mismatch, a wrong id, a damaged shard and leaves nothing behind", async () => {
    const dir = tmp();
    const good = await pack();
    await expect(install(dir, serve(good, "0".repeat(64)))).rejects.toThrow(/checksum/);
    await expect(install(dir, serve(good, "nonsense"))).rejects.toThrow(/SHA-256 line/);
    await expect(install(dir, serve(await pack("poe2-9.8.9+r1")))).rejects.toThrow(/names itself/);
    const damaged = await pack(ID, (d) => writeFileSync(join(d, "shards", "gem.json"), "{}"));
    await expect(install(dir, serve(damaged))).rejects.toThrow(/hash/);
    const noShard = await pack(ID, (d) => writeFileSync(join(d, "manifest.json"), "{}"));
    await expect(install(dir, serve(noShard))).rejects.toThrow(/contract/);
    expect(await installedReleaseIds(dir)).toEqual([]);
    expect(await removeLeftovers(dir)).toBe(0);
  });
  it("refuses links in the archive, oversize downloads and failed requests", async () => {
    const dir = tmp();
    const withLink = await pack(ID, (d) => symlinkSync("/etc/passwd", join(d, "link")));
    await expect(install(dir, serve(withLink))).rejects.toThrow(/other than files/);
    const good = await pack();
    await expect(install(dir, serve(good), remote(ID), { maxDownloadBytes: 10 })).rejects.toThrow(
      /larger/,
    );
    await expect(install(dir, serve(good), remote(ID), { maxUnpackedBytes: 10 })).rejects.toThrow(
      /unpacked/,
    );
    await expect(install(dir, async () => new Response("no", { status: 404 }))).rejects.toThrow(
      /404/,
    );
    await expect(
      install(dir, async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow(/failed/);
    expect(await installedReleaseIds(dir)).toEqual([]);
  });
  it("removes leftovers of interrupted installs", async () => {
    const dir = tmp();
    mkdirSync(join(dir, ".installing-abc"));
    expect(await removeLeftovers(dir)).toBe(1);
    expect(await installedReleaseIds(dir)).toEqual([]);
  });
});
