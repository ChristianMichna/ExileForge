import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

/** Same format as apps/server/src/access-token.ts. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** The token file does not exist yet: the app has never been started on this PC. */
export class TokenMissingError extends Error {
  override readonly name = "TokenMissingError";
}

/** The token file exists but does not hold a valid token. */
export class TokenInvalidError extends Error {
  override readonly name = "TokenInvalidError";
}

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
 * Claude Desktop.
 */
export function fetchWithToken(tokenFile: string, base: FetchLike = fetch): FetchLike {
  return async (url, init) => {
    let token: string;
    try {
      token = (await readFile(tokenFile, "utf8")).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new TokenMissingError(`ExileForge access token not found at ${tokenFile}`, {
          cause: error,
        });
      }
      throw new TokenInvalidError(`Cannot read ExileForge access token ${tokenFile}`, {
        cause: error,
      });
    }
    if (!TOKEN_PATTERN.test(token)) {
      throw new TokenInvalidError(`ExileForge access token file ${tokenFile} is damaged`);
    }
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    return base(url, { ...init, headers });
  };
}
