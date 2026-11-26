import { z } from "zod";
import { compareReleaseIds, releaseIdOfTag } from "./release-id.js";

/** Injected so tests (and the app's own network layer) control the transport. */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>;

export interface RemoteRelease {
  readonly id: string;
  readonly tag: string;
  readonly prerelease: boolean;
  readonly publishedAt: string;
  readonly catalogUrl: string;
  readonly checksumUrl: string;
  readonly catalogSize: number;
}

export interface ListOptions {
  fetch: FetchLike;
  /** "owner/name" of the repository that publishes data releases. */
  repo: string;
  /** Identifiable client name, e.g. "Astrolabe/0.1.0 (+https://github.com/owner/name)". */
  userAgent: string;
  signal?: AbortSignal;
}

const Asset = z.object({
  name: z.string(),
  size: z.number().int().nonnegative(),
  browser_download_url: z.url(),
});
const ReleaseList = z.array(
  z.object({
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    published_at: z.string().nullable(),
    assets: z.array(Asset),
  }),
);

const REPO_PATTERN = /^(?!\.+\/)[A-Za-z0-9_.-]+\/(?!\.+$)[A-Za-z0-9_.-]+$/;
export const RELEASES_PER_PAGE = 100;

/** Downloads may only come from this repository's own release files. */
export function isOwnReleaseUrl(url: string, repo: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      u.hostname === "github.com" &&
      u.pathname.toLowerCase().startsWith(`/${repo.toLowerCase()}/releases/download/`)
    );
  } catch {
    return false;
  }
}

/**
 * Lists the data releases of the repository, newest first. Releases without a catalog and
 * checksum asset, drafts and foreign tags are skipped; a failing request is an error, never an
 * empty list.
 */
export async function listRemoteReleases(options: ListOptions): Promise<RemoteRelease[]> {
  if (!REPO_PATTERN.test(options.repo)) throw new Error(`Invalid repository name: ${options.repo}`);
  const url = `https://api.github.com/repos/${options.repo}/releases?per_page=${RELEASES_PER_PAGE}`;
  let response: Response;
  try {
    response = await options.fetch(url, {
      headers: { "User-Agent": options.userAgent, Accept: "application/vnd.github+json" },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (cause) {
    throw new Error("Could not reach GitHub to look for new data releases", { cause });
  }
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} when listing data releases`);
  }
  const parsed = ReleaseList.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(
      `GitHub's release list has an unexpected shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  const found: RemoteRelease[] = [];
  for (const release of parsed.data) {
    const id = releaseIdOfTag(release.tag_name);
    if (release.draft || id === undefined || release.published_at === null) continue;
    const base = `catalog-${id.replace("+", "-")}.tar.gz`;
    const catalog = release.assets.find((a) => a.name === base);
    const checksum = release.assets.find((a) => a.name === `${base}.sha256`);
    if (
      catalog === undefined ||
      checksum === undefined ||
      !isOwnReleaseUrl(catalog.browser_download_url, options.repo) ||
      !isOwnReleaseUrl(checksum.browser_download_url, options.repo)
    ) {
      continue;
    }
    found.push({
      id,
      tag: release.tag_name,
      prerelease: release.prerelease,
      publishedAt: release.published_at,
      catalogUrl: catalog.browser_download_url,
      checksumUrl: checksum.browser_download_url,
      catalogSize: catalog.size,
    });
  }
  return found.sort((a, b) => compareReleaseIds(b.id, a.id));
}

/**
 * The newest remote release that is newer than everything installed, or undefined. Pre-releases
 * count only when `includePrereleases` is set.
 */
export function pickNewRelease(
  remote: readonly RemoteRelease[],
  installedIds: readonly string[],
  options: { includePrereleases: boolean },
): RemoteRelease | undefined {
  const eligible = remote.filter((r) => options.includePrereleases || !r.prerelease);
  const newest = eligible.reduce<RemoteRelease | undefined>(
    (best, r) => (best === undefined || compareReleaseIds(r.id, best.id) > 0 ? r : best),
    undefined,
  );
  if (newest === undefined) return undefined;
  const installedNewest = installedIds.reduce<string | undefined>(
    (best, id) => (best === undefined || compareReleaseIds(id, best) > 0 ? id : best),
    undefined,
  );
  return installedNewest !== undefined && compareReleaseIds(newest.id, installedNewest) <= 0
    ? undefined
    : newest;
}
