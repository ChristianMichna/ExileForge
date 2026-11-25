import { z } from "zod";
import type { ActionResult, AppStatus, OpenClaudeResult } from "../shared/bridge.js";
import { buildClaudeCodeCommand, buildStartSentence, openClaudeDesktop } from "./claude.js";
import type { DesktopConfig } from "./config.js";
import type { UpdateController } from "./updater.js";

const RunIdArg = z.string().min(1).max(100);
const SessionCodeReply = z.object({ sessionCode: z.string().min(1), expiresAt: z.string().min(1) });

export interface HandlerDeps {
  config: DesktopConfig;
  getStatus(): AppStatus;
  /** Server URL and token once the server runs. */
  server(): { url: string; token: string } | undefined;
  fetch: typeof fetch;
  clipboardWrite(text: string): void;
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
        { method: "POST", headers: { authorization: `Bearer ${server.token}` } },
      );
      if (!response.ok) {
        throw new Error(`The server refused to issue a session code (HTTP ${response.status}).`);
      }
      const issued = SessionCodeReply.parse(await response.json());
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
      deps.clipboardWrite(buildClaudeCodeCommand(server.url, server.token));
      return {
        ok: true,
        message: "Command copied. Paste it into a terminal where Claude Code is installed.",
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
      await updates.check();
      return { ok: true, message: "Checking for updates." };
    },

    installUpdate(): ActionResult {
      const started = deps.updates()?.installNow() ?? false;
      return started
        ? { ok: true, message: "Restarting to install the update." }
        : { ok: false, message: "No downloaded update is waiting." };
    },
  };
}
