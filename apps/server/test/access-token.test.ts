import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultTokenFile, loadOrCreateAccessToken } from "../src/access-token.js";

describe("access token", () => {
  it("creates an owner-only token once and reuses it", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "ef-token-")), "sub", "access-token");
    const first = await loadOrCreateAccessToken(file);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await loadOrCreateAccessToken(file)).toBe(first);
    expect(readFileSync(file, "utf8").trim()).toBe(first);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o077).toBe(0);
  });

  it("refuses a damaged token file instead of replacing it silently", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "ef-token-")), "access-token");
    writeFileSync(file, "short");
    await expect(loadOrCreateAccessToken(file)).rejects.toThrow(/damaged/);
  });

  it("uses %APPDATA% on Windows-style environments", () => {
    expect(defaultTokenFile({ APPDATA: "C:\\Users\\x\\AppData\\Roaming" })).toContain("ExileForge");
  });
});
