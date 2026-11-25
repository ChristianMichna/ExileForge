import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  shell,
} from "electron";
import { autoUpdater } from "electron-updater";
import { join } from "node:path";
import { createStderrLogger } from "@astrolabe/server";
import { IPC } from "../shared/bridge.js";
import { createAppProtocolHandler } from "./app-protocol.js";
import { loadDesktopConfig, type DesktopConfig } from "./config.js";
import { createHandlers } from "./ipc-handlers.js";
import { findDataRelease, resolveAppDirs } from "./resources.js";
import { APP_SCHEME, APP_URL, isAppUrl, isTrustedSender } from "./security.js";
import { startServices, type Services } from "./services.js";
import { StatusStore } from "./status.js";
import { startUpdates, type UpdateController } from "./updater.js";

const logger = createStderrLogger("desktop");

// The window and the userData folder (%APPDATA%\Astrolabe) are named after the app.
app.setName("Astrolabe");

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

let mainWindow: BrowserWindow | undefined;
let services: Services | undefined;
let updates: UpdateController | undefined;

/** Repository root when running unpackaged (dist/main.cjs → apps/desktop → repo). */
const repoRoot = join(__dirname, "..", "..", "..");

if (!app.requestSingleInstanceLock()) {
  // A second instance would fight for the port; hand over to the first one.
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow === undefined) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, url) => {
      if (!isAppUrl(url)) event.preventDefault();
    });
    contents.on("will-redirect", (event, url) => {
      if (!isAppUrl(url)) event.preventDefault();
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
  app.on("window-all-closed", () => app.quit());
  let stopped = false;
  app.on("before-quit", (event) => {
    updates?.stop();
    if (stopped || services === undefined) return;
    // Let the server and SQLite close cleanly before the process ends.
    event.preventDefault();
    stopped = true;
    void services
      .stop()
      .catch((error: unknown) => logger.error("server stop failed", { error }))
      .finally(() => app.quit());
  });
  void app.whenReady().then(boot).catch(fatal);
}

async function boot(): Promise<void> {
  const dirs = resolveAppDirs({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    repoRoot,
    userData: app.getPath("userData"),
  });
  const config = await loadDesktopConfig(dirs.desktopConfigPath);
  const status = new StatusStore(app.getVersion(), {
    state: "disabled",
    reason: app.isPackaged ? "Updates are switched off in the settings." : "Not an installed app.",
  });

  hardenSession(`http://127.0.0.1:${config.port}/`);
  const handleApp = createAppProtocolHandler({
    webRoot: dirs.webRoot,
    serverUrl: () => services?.url,
    token: () => services?.token,
    fetch: (input, init) => net.fetch(input as string, init),
  });
  protocol.handle(APP_SCHEME, (request) => handleApp(request));

  const handlers = createHandlers({
    config,
    getStatus: () => status.get(),
    server: () =>
      services === undefined ? undefined : { url: services.url, token: services.token },
    fetch: (input, init) => net.fetch(input as string, init),
    clipboardWrite: (text) => clipboard.writeText(text),
    clipboardRead: () => clipboard.readText(),
    openExternal: (url) => shell.openExternal(url),
    openPath: (path) => shell.openPath(path),
    extensionPath: dirs.extensionPath,
    updates: () => updates,
  });
  registerIpc(handlers, status);

  mainWindow = createWindow(config);
  status.subscribe((next) => {
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.statusChanged, next);
    }
  });
  await mainWindow.loadURL(APP_URL);

  // Server start comes after the window so the person sees progress or the error, not nothing.
  try {
    const catalogDir = await findDataRelease(dirs, process.env["ASTROLABE_DATA_RELEASE"]);
    services = await startServices({
      port: config.port,
      databasePath: dirs.databasePath,
      catalogDir,
      forgeConfigPath: dirs.forgeConfigPath,
      stagesConfigPath: dirs.stagesConfigPath,
      logger,
    });
    status.setServer({
      state: "ready",
      port: services.port,
      calcEngine: services.calcEngine,
      dataReleaseId: services.dataReleaseId,
    });
  } catch (error) {
    logger.error("server failed to start", { error });
    status.setServer({
      state: "failed",
      message: error instanceof Error ? error.message : "The local server failed to start.",
    });
  }

  if (app.isPackaged && config.update.enabled) {
    updates = startUpdates({
      updater: autoUpdater,
      setState: (state) => status.setUpdate(state),
      firstCheckDelayMs: config.update.firstCheckDelaySeconds * 1000,
      intervalMs: config.update.checkIntervalHours * 3_600_000,
    });
    status.setUpdate({ state: "idle" });
  }
}

function createWindow(config: DesktopConfig): BrowserWindow {
  const win = new BrowserWindow({
    ...config.window,
    backgroundColor: "#0b0d0e",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.once("ready-to-show", () => win.show());
  return win;
}

/** No camera, location, notifications or other permission for the page; no foreign requests. */
function hardenSession(serverPrefix: string): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    // The app's own origin and the local server. net.fetch from the main process passes this
    // filter too (checked); the page itself is held back by its CSP (connect-src 'self').
    const allowed =
      isAppUrl(url) ||
      url.startsWith(serverPrefix) ||
      url.startsWith("devtools:") ||
      url.startsWith("data:") ||
      url.startsWith("blob:");
    callback({ cancel: !allowed });
  });
}

function registerIpc(handlers: ReturnType<typeof createHandlers>, status: StatusStore): void {
  const guard =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (event: Electron.IpcMainInvokeEvent, ...args: A): R => {
      if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted IPC sender");
      return fn(...args);
    };
  ipcMain.handle(
    IPC.getStatus,
    guard(() => status.get()),
  );
  ipcMain.handle(
    IPC.openClaude,
    guard((runId: unknown) => handlers.openClaude(runId)),
  );
  ipcMain.handle(
    IPC.copyClaudeCodeCommand,
    guard(() => handlers.copyClaudeCodeCommand()),
  );
  ipcMain.handle(
    IPC.installClaudeExtension,
    guard(() => handlers.installClaudeExtension()),
  );
  ipcMain.handle(
    IPC.checkForUpdates,
    guard(() => handlers.checkForUpdates()),
  );
  ipcMain.handle(
    IPC.installUpdate,
    guard(() => handlers.installUpdate()),
  );
}

function fatal(error: unknown): void {
  logger.error("startup failed", { error });
  dialog.showErrorBox(
    "Astrolabe could not start",
    error instanceof Error ? error.message : "Unknown error",
  );
  app.quit();
}
