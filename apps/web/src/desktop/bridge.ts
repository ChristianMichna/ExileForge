/*
 * Structural copy of the bridge contract in apps/desktop/src/shared/bridge.ts.
 * The Electron preload script exposes it as `window.astrolabe`; in a normal
 * browser it is absent and the app shows the sample data only.
 */

export type ServerState =
  | { readonly state: "starting" }
  | {
      readonly state: "ready";
      readonly port: number;
      readonly calcEngine: "fake" | "pob" | "none";
      /** Set when calcEngine is "none": why planning is unavailable. */
      readonly catalogOnlyReason?: string;
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

export type DataState =
  | { readonly state: "disabled"; readonly reason: string }
  | { readonly state: "idle" }
  | { readonly state: "checking" }
  | { readonly state: "downloading"; readonly releaseId: string }
  | { readonly state: "ready"; readonly releaseId: string }
  | { readonly state: "failed"; readonly message: string };

export interface AppStatus {
  readonly appVersion: string;
  readonly server: ServerState;
  readonly update: UpdateState;
  readonly data: DataState;
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
  checkForData(): Promise<ActionResult>;
  restartForData(): Promise<ActionResult>;
}

declare global {
  interface Window {
    astrolabe?: DesktopBridge;
  }
}

/** The bridge when running inside the desktop app, otherwise undefined. */
export function getDesktopBridge(): DesktopBridge | undefined {
  return typeof window === "undefined" ? undefined : window.astrolabe;
}
