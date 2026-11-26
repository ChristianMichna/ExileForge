import { z } from "zod";

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

const RELEASE_ID_TAG = /^data-poe2-(\d+(?:\.\d+){1,3})-r[1-9]\d*$/;

async function getJson(fetch: FetchLike, url: string, token: string | undefined): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "astrolabe-patch-watch",
  };
  if (token !== undefined && token !== "") headers["Authorization"] = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GitHub answered ${String(response.status)} for ${url}`);
  return response.json();
}

/** Game versions of the data releases published in this repository (drafts ignored). */
export async function listDataGameVersions(
  fetch: FetchLike,
  repo: string,
  token?: string,
): Promise<string[]> {
  const body = z
    .array(z.object({ tag_name: z.string(), draft: z.boolean() }))
    .parse(
      await getJson(fetch, `https://api.github.com/repos/${repo}/releases?per_page=100`, token),
    );
  return [
    ...new Set(
      body.flatMap((r) => {
        const version = r.draft ? undefined : RELEASE_ID_TAG.exec(r.tag_name)?.[1];
        return version === undefined ? [] : [version];
      }),
    ),
  ];
}

/** Latest published PoB release and the commit its tag points to. */
export async function latestPobRelease(
  fetch: FetchLike,
  pobRepo: string,
  token?: string,
): Promise<{ tag: string; sha: string }> {
  const release = z
    .object({ tag_name: z.string().min(1) })
    .parse(await getJson(fetch, `https://api.github.com/repos/${pobRepo}/releases/latest`, token));
  const commit = z
    .object({ sha: z.string().regex(/^[0-9a-f]{40}$/) })
    .parse(
      await getJson(
        fetch,
        `https://api.github.com/repos/${pobRepo}/commits/${encodeURIComponent(release.tag_name)}`,
        token,
      ),
    );
  return { tag: release.tag_name, sha: commit.sha };
}
