import { app, BrowserWindow, ipcMain } from "electron";
import { dirname, join } from "node:path";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHostSession, findWorkspaceRoot } from "./hostSession.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");
const timingEnabled = process.env.DDD_APPLET_TIMING === "1";
const benchmarkMode = process.env.DDD_APPLET_BENCHMARK === "1";
const t0 = Date.now();
const marks = [];

function mark(label) {
  if (!timingEnabled && !benchmarkMode) {
    return;
  }
  marks.push({ label, ms: Date.now() - t0 });
}

function printTiming(summaryLabel) {
  const lines = [`[ddd-applet timing] ${summaryLabel}`];
  for (const entry of marks) {
    lines.push(`  ${entry.label.padEnd(22)} ${entry.ms}ms`);
  }
  const ready = marks.find((entry) => entry.label === "diagram-render");
  if (ready) {
    lines.push(`  ${"→ interactive".padEnd(22)} ${ready.ms}ms`);
  }
  console.log(lines.join("\n"));
}

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
  mark("window-created");
  mainWindow.webContents.on("dom-ready", () => {
    mark("dom-ready");
  });
  mainWindow.webContents.on("did-finish-load", () => {
    mark("did-finish-load");
  });
  void mainWindow.loadFile(join(distDir, "index.html"));
  mark("load-file-called");
  return mainWindow;
}

app.whenReady().then(async () => {
  mark("app-ready");
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

  session = createHostSession({ diagramPath, workspaceRoot, pushToRenderer });
  await session.init();
  mark("session-init");

  ipcMain.on("ddd-host", (_event, message) => {
    if (message?.type === "timing" && message.phase === "diagram-render") {
      mark("diagram-render");
      printTiming(diagramPath);
      if (benchmarkMode) {
        app.quit();
      }
      return;
    }
    if (message?.type === "ready") {
      mark("webview-ready");
    }
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
