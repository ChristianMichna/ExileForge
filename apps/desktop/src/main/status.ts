import type { AppStatus, DataState, ServerState, UpdateState } from "../shared/bridge.js";

/** Holds the status shown in the app and tells listeners about every change. */
export class StatusStore {
  private status: AppStatus;
  private readonly listeners = new Set<(status: AppStatus) => void>();

  constructor(appVersion: string, update: UpdateState, data: DataState) {
    this.status = { appVersion, server: { state: "starting" }, update, data };
  }

  get(): AppStatus {
    return this.status;
  }

  setServer(server: ServerState): void {
    this.set({ ...this.status, server });
  }

  setUpdate(update: UpdateState): void {
    this.set({ ...this.status, update });
  }

  setData(data: DataState): void {
    this.set({ ...this.status, data });
  }

  subscribe(listener: (status: AppStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: AppStatus): void {
    this.status = next;
    for (const listener of this.listeners) listener(next);
  }
}
