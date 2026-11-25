import { contextBridge, ipcRenderer } from "electron";
import { IPC, type AppStatus, type DesktopBridge } from "./shared/bridge.js";

/*
 * Runs sandboxed, before the page. Exposes only the narrow DesktopBridge; the
 * page gets no ipcRenderer, no Node and no access token.
 */
const bridge: DesktopBridge = {
  getStatus: () => ipcRenderer.invoke(IPC.getStatus),
  onStatus(listener) {
    const wrapped = (_event: unknown, status: AppStatus) => listener(status);
    ipcRenderer.on(IPC.statusChanged, wrapped);
    return () => {
      ipcRenderer.removeListener(IPC.statusChanged, wrapped);
    };
  },
  openClaude: (runId) => ipcRenderer.invoke(IPC.openClaude, runId),
  copyClaudeCodeCommand: () => ipcRenderer.invoke(IPC.copyClaudeCodeCommand),
  installClaudeExtension: () => ipcRenderer.invoke(IPC.installClaudeExtension),
  checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates),
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
};

contextBridge.exposeInMainWorld("exileforge", bridge);
