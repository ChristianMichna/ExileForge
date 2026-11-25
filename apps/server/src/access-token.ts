import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Default location of the access token, shared with the .mcpb bridge:
 * %APPDATA%\Astrolabe\access-token on Windows, ~/.config/astrolabe elsewhere.
 */
export function defaultTokenFile(env: Record<string, string | undefined> = process.env): string {
  const appData = env["APPDATA"];
  return appData !== undefined && appData !== ""
    ? join(appData, "Astrolabe", "access-token")
    : join(homedir(), ".config", "astrolabe", "access-token");
}

/** Reads the per-installation token, creating it (owner-only file) on first start. */
export async function loadOrCreateAccessToken(path: string): Promise<string> {
  let existing: string | undefined;
  try {
    existing = (await readFile(path, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Cannot read access token ${path}`, { cause: error });
    }
  }
  if (existing !== undefined) {
    if (!TOKEN_PATTERN.test(existing)) throw new Error(`Access token file ${path} is damaged`);
    return existing;
  }
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${token}\n`, { mode: 0o600, flag: "wx" });
  return token;
}
