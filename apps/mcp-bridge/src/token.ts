import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

/** Same default location as apps/server (src/access-token.ts). */
export function defaultTokenFile(env: Record<string, string | undefined>): string {
  const appData = env["APPDATA"];
  return appData !== undefined && appData !== ""
    ? join(appData, "ExileForge", "access-token")
    : join(homedir(), ".config", "exileforge", "access-token");
}

/**
 * fetch that adds the app's access token, read fresh on each request so the
 * bridge keeps working when the app is started (and creates the token) after
 * Claude Desktop. A missing token file means the app never ran: the request
 * fails, and the bridge answers Claude with "start the app".
 */
export function fetchWithToken(tokenFile: string, base: FetchLike = fetch): FetchLike {
  return async (url, init) => {
    let token: string;
    try {
      token = (await readFile(tokenFile, "utf8")).trim();
    } catch (error) {
      throw new Error(`ExileForge access token not found at ${tokenFile}`, { cause: error });
    }
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    return base(url, { ...init, headers });
  };
}
