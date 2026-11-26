import { z } from "zod";
import { PobVersion } from "@astrolabe/contracts";

type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>;

const RELEASE_ID_TAG = /^data-poe2-(\d+(?:\.\d+){1,3})-r[1-9]\d*$/;

async function getJson(
  fetch: FetchLike,
  url: string,
  token: string | undefined,
  timeoutSeconds: number,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "astrolabe-patch-watch",
  };
  if (token !== undefined && token !== "") headers["Authorization"] = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutSeconds * 1000) });
  } catch (cause) {
    throw new Error(`Could not reach GitHub for ${url}`, { cause });
  }
  if (!response.ok) throw new Error(`GitHub answered ${String(response.status)} for ${url}`);
  try {
    return await response.json();
  } catch (cause) {
    throw new Error(`GitHub's answer for ${url} is not valid JSON`, { cause });
  }
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
  timeoutSeconds: number,
  token?: string,
): Promise<{ tag: string; sha: string }> {
  const release = z
    .object({ tag_name: PobVersion })
    .parse(
      await getJson(
        fetch,
        `https://api.github.com/repos/${pobRepo}/releases/latest`,
        token,
        timeoutSeconds,
      ),
    );
  const commit = z
    .object({ sha: z.string().regex(/^[0-9a-f]{40}$/) })
    .parse(
      await getJson(
        fetch,
        `https://api.github.com/repos/${pobRepo}/commits/${encodeURIComponent(release.tag_name)}`,
        token,
        timeoutSeconds,
      ),
    );
  return { tag: release.tag_name, sha: commit.sha };
}
