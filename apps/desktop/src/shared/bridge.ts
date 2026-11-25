/*
 * Contract between the Electron main process and the frontend (apps/web) over
 * the preload bridge. The renderer never receives the access token, file
 * paths or stack traces: only what is listed here. apps/web keeps a
 * structural copy of these types (apps/web/src/desktop/bridge.ts).
 */

export type ServerState =
  | { readonly state: "starting" }
  | {
      readonly state: "ready";
      readonly port: number;
      readonly calcEngine: "fake" | "pob";
      readonly dataReleaseId: string;
    }
  | { readonly state: "failed"; readonly message: string };

export type UpdateState =
  | { readonly state: "disabled"; readonly reason: string }
  | { readonly state: "idle" }
  | { readonly state: "checking" }
  | { readonly state: "downloading"; readonly percent: number }
  | { readonly state: "ready"; readonly version: string }
  | { readonly state: "failed"; readonly message: string };

export interface AppStatus {
  readonly appVersion: string;
  readonly server: ServerState;
  readonly update: UpdateState;
}

export interface OpenClaudeResult {
  readonly sessionCode: string;
  readonly expiresAt: string;
  /** The sentence that was copied to the clipboard. */
  readonly startSentence: string;
  /** False when Claude Desktop could not be opened; the sentence is still copied. */
  readonly claudeDesktopOpened: boolean;
  /** Plain-language reason when `claudeDesktopOpened` is false. */
  readonly notOpenedReason?: string;
}

export interface ActionResult {
  readonly ok: boolean;
  /** Plain-language explanation, always present when `ok` is false. */
  readonly message: string;
}

export interface DesktopBridge {
  getStatus(): Promise<AppStatus>;
  /** Subscribes to status changes; returns the unsubscribe function. */
  onStatus(listener: (status: AppStatus) => void): () => void;
  /** Issues a session code for the run, copies the start sentence and opens Claude Desktop. */
  openClaude(runId: string): Promise<OpenClaudeResult>;
  /** Copies the `claude mcp add ...` command (with the access token) to the clipboard. */
  copyClaudeCodeCommand(): Promise<ActionResult>;
  /** Opens the bundled Claude Desktop extension (.mcpb) for installation. */
  installClaudeExtension(): Promise<ActionResult>;
  checkForUpdates(): Promise<ActionResult>;
  installUpdate(): Promise<ActionResult>;
}

export const IPC = {
  getStatus: "exileforge:status:get",
  statusChanged: "exileforge:status:changed",
  openClaude: "exileforge:claude:open",
  copyClaudeCodeCommand: "exileforge:claude:copy-command",
  installClaudeExtension: "exileforge:claude:install-extension",
  checkForUpdates: "exileforge:update:check",
  installUpdate: "exileforge:update:install",
} as const;
