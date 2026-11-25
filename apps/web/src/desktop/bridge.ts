/*
 * Structural copy of the bridge contract in apps/desktop/src/shared/bridge.ts.
 * The Electron preload script exposes it as `window.exileforge`; in a normal
 * browser it is absent and the app shows the sample data only.
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
  readonly startSentence: string;
  readonly claudeDesktopOpened: boolean;
  readonly notOpenedReason?: string;
}

export interface ActionResult {
  readonly ok: boolean;
  readonly message: string;
}

export interface DesktopBridge {
  getStatus(): Promise<AppStatus>;
  onStatus(listener: (status: AppStatus) => void): () => void;
  openClaude(runId: string): Promise<OpenClaudeResult>;
  copyClaudeCodeCommand(): Promise<ActionResult>;
  installClaudeExtension(): Promise<ActionResult>;
  checkForUpdates(): Promise<ActionResult>;
  installUpdate(): Promise<ActionResult>;
}

declare global {
  interface Window {
    exileforge?: DesktopBridge;
  }
}

/** The bridge when running inside the desktop app, otherwise undefined. */
export function getDesktopBridge(): DesktopBridge | undefined {
  return typeof window === "undefined" ? undefined : window.exileforge;
}
