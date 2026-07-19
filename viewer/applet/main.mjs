import { app, BrowserWindow, ipcMain } from "electron";
import { accessSync, constants } from "node:fs";
import { dirname, join } from "node:path";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHostSession, findWorkspaceRoot } from "./hostSession.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");

let session = null;
let reloadTimer = null;

function pushToRenderer(message) {
  const window = BrowserWindow.getAllWindows()[0];
  if (window && !window.isDestroyed()) {
    window.webContents.send("ddd-host-push", message);
  }
}

function scheduleReload() {
  if (reloadTimer) {
    clearTimeout(reloadTimer);
  }
  reloadTimer = setTimeout(() => {
    void session?.pushLatestFromDisk("watch");
  }, 50);
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 480,
    minHeight: 360,
    title: "Design Drive Development",
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    show: true,
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      v8CacheOptions: "code",
    },
  });

  mainWindow.setMenuBarVisibility(false);
  void mainWindow.loadFile(join(distDir, "index.html"));
  return mainWindow;
}

app.whenReady().then(async () => {
  const diagramPath = process.argv[2];
  if (!diagramPath) {
    console.error("Usage: electron applet/main.mjs <diagram.excalidraw>");
    app.quit();
    return;
  }

  try {
    await stat(diagramPath);
  } catch {
    console.error(`File not found: ${diagramPath}`);
    app.quit();
    return;
  }

  const workspaceRoot = findWorkspaceRoot(diagramPath);
  session = createHostSession({ diagramPath, workspaceRoot, pushToRenderer });
  await session.init();

  ipcMain.on("ddd-host", (_event, message) => {
    void session?.handleMessage(message);
  });

  ipcMain.on("ddd-get-diagram-sync", (event) => {
    event.returnValue = session?.getDiagramSync() ?? { path: diagramPath, content: "" };
  });

  session.watchDiagram(scheduleReload);
  const mainWindow = createWindow();

  mainWindow.on("close", () => {
    void session?.flushSave();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
