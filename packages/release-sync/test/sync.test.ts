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

const limits = {
  repo: REPO,
  allowedRedirectHosts: ["github.com", "release-assets.githubusercontent.com"],
  maxDownloadBytes: 10_000_000,
  maxUnpackedBytes: 10_000_000,
  maxChecksumBytes: 1024,
  maxDecompressionRatio: 1000,
  maxEntries: 1000,
};
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
    expect(await removeLeftovers(dir, 0)).toBe(0);
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
  it("limits what gets written, not only what was downloaded", async () => {
    const dir = tmp();
    // 5 MB of one byte compresses far below the ratio limit of 1000 only if the limit is loose
    const bomb = await pack(ID, (d) => writeFileSync(join(d, "big.bin"), Buffer.alloc(5_000_000)));
    await expect(
      install(dir, serve(bomb), remote(ID), { maxUnpackedBytes: 1000, maxDecompressionRatio: 1e9 }),
    ).rejects.toThrow(/unpacked release is larger/);
    await expect(
      install(dir, serve(bomb), remote(ID), { maxDecompressionRatio: 10 }),
    ).rejects.toThrow(/unpack/);
    const many = await pack(ID, (d) => {
      for (let i = 0; i < 20; i += 1) writeFileSync(join(d, `f${i}`), "x");
    });
    await expect(install(dir, serve(many), remote(ID), { maxEntries: 5 })).rejects.toThrow(
      /more than 5 entries/,
    );
    expect(await installedReleaseIds(dir)).toEqual([]);
  });
  it("refuses path tricks in the archive", async () => {
    const dir = tmp();
    const outer = tmp();
    mkdirSync(join(outer, "inner"));
    writeFileSync(join(outer, "escape.txt"), "x");
    const file = join(tmp(), "evil.tar.gz");
    await tar.create({ gzip: true, file, cwd: join(outer, "inner"), preservePaths: true }, [
      "../escape.txt",
    ]);
    await expect(install(dir, serve(readFileSync(file)))).rejects.toThrow();
    expect(existsSync(join(dir, "escape.txt"))).toBe(false);
    expect(await installedReleaseIds(dir)).toEqual([]);
  });
  it("only downloads release files of its own repository and only from allowed hosts", async () => {
    const dir = tmp();
    const good = await pack();
    const foreign = remote(ID, {
      catalogUrl: `https://github.com/other/x/releases/download/t/f.tar.gz`,
    });
    await expect(install(dir, serve(good), foreign)).rejects.toThrow(/not a release file/);
    const redirected: FetchLike = async (url) => {
      const r = serve(good)(url);
      const res = await r;
      Object.defineProperty(res, "url", { value: "https://evil.example/x" });
      return res;
    };
    await expect(install(dir, redirected)).rejects.toThrow(/redirected to evil.example/);
    const toCdn: FetchLike = async (url) => {
      const res = await serve(good)(url);
      Object.defineProperty(res, "url", {
        value: "https://release-assets.githubusercontent.com/x",
      });
      return res;
    };
    expect((await install(dir, toCdn)).alreadyInstalled).toBe(false);
  });
  it("limits the checksum file, the announced size and sends the user agent", async () => {
    const dir = tmp();
    const good = await pack();
    await expect(install(dir, async () => new Response("a".repeat(5000)))).rejects.toThrow(
      /checksum file is larger/,
    );
    await expect(
      install(dir, serve(good), remote(ID, { catalogSize: 99_999_999 })),
    ).rejects.toThrow(/larger than the allowed/);
    const agents: (string | undefined)[] = [];
    await install(dir, async (url, init) => {
      agents.push(init?.headers?.["User-Agent"]);
      return serve(good)(url);
    });
    expect(agents).toEqual([UA, UA]);
  });
  it("treats a finished parallel install as success and a foreign folder as an error", async () => {
    const dir = tmp();
    const good = await pack();
    const [a, b] = await Promise.all([install(dir, serve(good)), install(dir, serve(good))]);
    expect([a.dir, b.dir]).toEqual([join(dir, ID), join(dir, ID)]);
    expect(await installedReleaseIds(dir)).toEqual([ID]);
    const dir2 = tmp();
    mkdirSync(join(dir2, ID));
    writeFileSync(join(dir2, ID, "stray.txt"), "x");
    await expect(install(dir2, serve(good))).rejects.toThrow(/holds no release/);
  });
  it("removes leftovers of interrupted installs", async () => {
    const dir = tmp();
    mkdirSync(join(dir, ".installing-abc"));
    expect(await removeLeftovers(dir, 60_000)).toBe(0); // may be running right now
    expect(await removeLeftovers(dir, 0)).toBe(1);
    expect(await installedReleaseIds(dir)).toEqual([]);
  });
});
