import { join } from "node:path";
import { z } from "zod";
import type { ActionResult, AppStatus, OpenClaudeResult } from "../shared/bridge.js";
import { buildClaudeCodeCommand, buildStartSentence, openClaudeDesktop } from "./claude.js";
import type { DesktopConfig } from "./config.js";
import type { DataSyncController } from "./data-sync.js";
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
  /** Shows a file selected in the file manager (Explorer on Windows). */
  revealPath(path: string): void;
  /** Copies a file, creating the target folder; rejects with the cause. */
  copyFile(from: string, to: string): Promise<void>;
  /** Folder the user finds easily (Documents), where the extension file is placed. */
  documentsDir(): string;
  extensionPath: string;
  updates(): UpdateController | undefined;
  /** Game data sync; undefined when switched off. */
  dataSync?(): DataSyncController | undefined;
  /** Restarts the whole app (the new data release is read at start). */
  relaunch?(): void;
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
      // Windows has no default app for .mcpb, so opening the file only shows an "open with"
      // dialog. The file is shown in the file manager instead; the user installs it in Claude.
      const steps =
        'In Claude Desktop open Settings > Extensions and drag the file "astrolabe.mcpb" into the window (or use "Advanced settings" > "Install Extension..."), then confirm.';
      const target = join(deps.documentsDir(), "Astrolabe", "astrolabe.mcpb");
      try {
        await deps.copyFile(deps.extensionPath, target);
      } catch (error) {
        console.error("extension copy failed", error);
        deps.revealPath(deps.extensionPath);
        return {
          ok: false,
          message: `The file could not be copied to your Documents folder, so it is shown where the app keeps it. ${steps}`,
        };
      }
      deps.revealPath(target);
      return { ok: true, message: `The extension file is shown in your file manager. ${steps}` };
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

    async checkForData(): Promise<ActionResult> {
      const sync = deps.dataSync?.();
      if (sync === undefined) {
        return { ok: false, message: "Game data updates are switched off." };
      }
      const outcome = await sync.check();
      if (outcome.result === "failed") {
        return {
          ok: false,
          message: `Looking for new game data failed: ${outcome.message ?? "unknown error"}`,
        };
      }
      const message = {
        installed: "New game data was installed. Restart Astrolabe to use it.",
        "up-to-date": "The game data is up to date.",
        busy: "Already looking for new game data.",
      }[outcome.result];
      return { ok: true, message };
    },

    restartForData(): ActionResult {
      if (deps.getStatus().data.state !== "ready" || deps.relaunch === undefined) {
        return { ok: false, message: "No new game data is waiting." };
      }
      deps.relaunch();
      return { ok: true, message: "Restarting to use the new game data." };
    },
  };
}
