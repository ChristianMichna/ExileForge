import { describe, expect, it, vi } from "vitest";
import {
  buildClaudeCodeCommand,
  buildStartSentence,
  openClaudeDesktop,
} from "../src/main/claude.js";
import type { DesktopConfig } from "../src/main/config.js";
import { createHandlers, type HandlerDeps } from "../src/main/ipc-handlers.js";

const config: DesktopConfig = {
  version: "t",
  port: 47615,
  window: { width: 1, height: 1, minWidth: 1, minHeight: 1 },
  claude: {
    desktopUrl: "claude://",
    allowedSchemes: ["claude:"],
    startSentence: "Start session {code} now.",
  },
  update: { enabled: true, firstCheckDelaySeconds: 1, checkIntervalHours: 1 },
};

describe("claude helpers", () => {
  it("fills the session code into the sentence", () => {
    expect(buildStartSentence(config.claude.startSentence, "AB12-CD")).toBe(
      "Start session AB12-CD now.",
    );
  });

  it("builds the Claude Code command with URL and token", () => {
    expect(buildClaudeCodeCommand("http://127.0.0.1:47615", "tok")).toBe(
      'claude mcp add --transport http exileforge http://127.0.0.1:47615/mcp --header "Authorization: Bearer tok"',
    );
  });

  it("reports a failed open instead of hiding it", async () => {
    const outcome = await openClaudeDesktop(
      async () => {
        throw new Error("no handler");
      },
      "claude://",
      ["claude:"],
    );
    expect(outcome.opened).toBe(false);
    expect(outcome.reason).toContain("no handler");
  });

  it("does not open a URL outside the allowed schemes", async () => {
    const open = vi.fn(async () => undefined);
    const outcome = await openClaudeDesktop(open, "https://example.com", ["claude:"]);
    expect(outcome.opened).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps & { clipboard: string[] } {
  const clipboard: string[] = [];
  return {
    config,
    getStatus: () => ({
      appVersion: "1",
      server: { state: "starting" },
      update: { state: "idle" },
    }),
    server: () => ({ url: "http://127.0.0.1:47615", token: "tok" }),
    fetch: async () =>
      new Response(JSON.stringify({ sessionCode: "AB12-CD", expiresAt: "2026-01-01T00:00:00Z" })),
    clipboardWrite: (t) => clipboard.push(t),
    openExternal: async () => undefined,
    openPath: async () => "",
    extensionPath: "x.mcpb",
    updates: () => undefined,
    ...overrides,
    clipboard,
  };
}

describe("ipc handlers", () => {
  it("issues a code, copies the sentence and opens Claude", async () => {
    const d = deps();
    const result = await createHandlers(d).openClaude("run-1");
    expect(result).toMatchObject({ sessionCode: "AB12-CD", claudeDesktopOpened: true });
    expect(d.clipboard).toEqual(["Start session AB12-CD now."]);
  });

  it("copies the sentence even when Claude Desktop does not open", async () => {
    const d = deps({
      openExternal: async () => {
        throw new Error("nope");
      },
    });
    const result = await createHandlers(d).openClaude("run-1");
    expect(result.claudeDesktopOpened).toBe(false);
    expect(result.notOpenedReason).toContain("nope");
    expect(d.clipboard).toHaveLength(1);
  });

  it("fails loudly when the server refuses the code", async () => {
    const d = deps({ fetch: async () => new Response("{}", { status: 404 }) });
    await expect(createHandlers(d).openClaude("run-1")).rejects.toThrow("HTTP 404");
  });

  it("rejects a bad run id and a missing server", async () => {
    await expect(createHandlers(deps()).openClaude(42)).rejects.toThrow();
    await expect(createHandlers(deps({ server: () => undefined })).openClaude("r")).rejects.toThrow(
      "not running",
    );
  });

  it("copies the Claude Code command without returning the token", () => {
    const d = deps();
    const result = createHandlers(d).copyClaudeCodeCommand();
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("tok");
    expect(d.clipboard[0]).toContain("Bearer tok");
  });

  it("explains when the extension file cannot be opened", async () => {
    const result = await createHandlers(
      deps({ openPath: async () => "not found" }),
    ).installClaudeExtension();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("refuses updates outside the installed app and installs only after a download", async () => {
    const h = createHandlers(deps());
    expect((await h.checkForUpdates()).ok).toBe(false);
    expect(h.installUpdate().ok).toBe(false);
  });
});
