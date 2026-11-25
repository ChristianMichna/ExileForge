import { z } from "zod";
import type { ActionResult, AppStatus, OpenClaudeResult } from "../shared/bridge.js";
import { buildClaudeCodeCommand, buildStartSentence, openClaudeDesktop } from "./claude.js";
import type { DesktopConfig } from "./config.js";
import type { UpdateController } from "./updater.js";

/** How long the Claude Code command (with token) may stay on the clipboard. */
const CLIPBOARD_CLEAR_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const ServerError = z.object({ error: z.object({ message: z.string() }) });
const RunIdArg = z.string().min(1).max(100);
const SessionCodeReply = z.object({ sessionCode: z.string().min(1), expiresAt: z.iso.datetime() });

export interface HandlerDeps {
  config: DesktopConfig;
  getStatus(): AppStatus;
  /** Server URL and token once the server runs. */
  server(): { url: string; token: string } | undefined;
  fetch: typeof fetch;
  clipboardWrite(text: string): void;
  clipboardRead(): string | Promise<string>;
  openExternal(url: string): Promise<void>;
  /** Opens a local file with its associated app; resolves to an error text or "". */
  openPath(path: string): Promise<string>;
  extensionPath: string;
  updates(): UpdateController | undefined;
}

/** The actions the renderer may trigger. Arguments are validated here, not trusted. */
export function createHandlers(deps: HandlerDeps) {
  return {
    getStatus: (): AppStatus => deps.getStatus(),

    async openClaude(runIdArg: unknown): Promise<OpenClaudeResult> {
      const runId = RunIdArg.parse(runIdArg);
      const server = deps.server();
      if (server === undefined) throw new Error("The local server is not running.");
      const response = await deps.fetch(
        `${server.url}/api/runs/${encodeURIComponent(runId)}/session-code`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${server.token}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        const detail = await response.json().catch(() => undefined);
        const message = ServerError.safeParse(detail);
        throw new Error(
          `The server refused to issue a session code: ${message.success ? message.data.error.message : `HTTP ${response.status}`}`,
        );
      }
      const parsed = SessionCodeReply.safeParse(await response.json());
      if (!parsed.success) throw new Error("The server sent an unexpected session code answer.");
      const issued = parsed.data;
      const startSentence = buildStartSentence(
        deps.config.claude.startSentence,
        issued.sessionCode,
      );
      deps.clipboardWrite(startSentence);
      const outcome = await openClaudeDesktop(
        deps.openExternal,
        deps.config.claude.desktopUrl,
        deps.config.claude.allowedSchemes,
      );
      return {
        sessionCode: issued.sessionCode,
        expiresAt: issued.expiresAt,
        startSentence,
        claudeDesktopOpened: outcome.opened,
        ...(outcome.reason === undefined ? {} : { notOpenedReason: outcome.reason }),
      };
    },

    copyClaudeCodeCommand(): ActionResult {
      const server = deps.server();
      if (server === undefined) return { ok: false, message: "The local server is not running." };
      const command = buildClaudeCodeCommand(server.url, server.token);
      deps.clipboardWrite(command);
      // The command holds the token: remove it from the clipboard again unless something else was copied.
      const timer = setTimeout(() => {
        void Promise.resolve(deps.clipboardRead())
          .then((current) => {
            if (current === command) deps.clipboardWrite("");
          })
          .catch((error: unknown) => console.error("clipboard clear failed", error));
      }, CLIPBOARD_CLEAR_MS);
      timer.unref();
      return {
        ok: true,
        message:
          "Command copied (it contains your access token and leaves the clipboard after 60 seconds). Paste it into a terminal where Claude Code is installed.",
      };
    },

    async installClaudeExtension(): Promise<ActionResult> {
      const failure = await deps.openPath(deps.extensionPath);
      return failure === ""
        ? {
            ok: true,
            message: "Claude Desktop opens the extension. Confirm the installation there.",
          }
        : {
            ok: false,
            message: `The extension file could not be opened (${failure}). Is Claude Desktop installed?`,
          };
    },

    async checkForUpdates(): Promise<ActionResult> {
      const updates = deps.updates();
      if (updates === undefined) {
        return { ok: false, message: "Updates are only available in the installed app." };
      }
      const outcome = await updates.check();
      if (outcome.result === "failed") {
        return {
          ok: false,
          message: `The update check failed: ${outcome.message ?? "unknown error"}`,
        };
      }
      return {
        ok: true,
        message:
          outcome.result === "already-downloaded"
            ? "An update is already downloaded. Restart to install it."
            : "Checking for updates.",
      };
    },

    installUpdate(): ActionResult {
      const started = deps.updates()?.installNow() ?? false;
      return started
        ? { ok: true, message: "Restarting to install the update." }
        : { ok: false, message: "No downloaded update is waiting." };
    },
  };
}
