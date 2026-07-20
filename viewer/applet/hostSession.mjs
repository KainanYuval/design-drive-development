import { clipboard, dialog } from "electron";
import { createHash } from "node:crypto";
import { existsSync, watch } from "node:fs";
import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const AUTO_SAVE_DELAY_MS = 300;
const encoder = new TextEncoder();

function hashContent(text) {
  return createHash("sha256").update(encoder.encode(text)).digest("hex");
}

function liveElementCountFromJson(text) {
  try {
    const parsed = JSON.parse(text);
    return (parsed.elements ?? []).filter((element) => !element.isDeleted).length;
  } catch {
    return 0;
  }
}

export function findWorkspaceRoot(diagramPath) {
  let dir = path.dirname(path.resolve(diagramPath));
  const fsRoot = path.parse(dir).root;

  while (true) {
    if (
      existsSync(path.join(dir, ".vscode", "settings.json")) ||
      existsSync(path.join(dir, ".git"))
    ) {
      return dir;
    }
    if (dir === fsRoot) {
      return path.dirname(path.resolve(diagramPath));
    }
    dir = path.dirname(dir);
  }
}

export function createHostSession({ diagramPath, workspaceRoot, pushToRenderer }) {
  let diagramContent = "";
  let contentHash = "";
  let diagramMtimeMs = 0;
  let webviewReady = false;
  let acceptWebviewEdits = false;
  let hasUnsavedWebviewEdits = false;
  let lastPushedHash = "";
  let lastWebviewSaveHash = "";
  let saveTimer = null;
  let selectionRequestId = 0;
  const pendingSelection = new Map();

  async function readDiskText() {
    return readFile(diagramPath, "utf8");
  }

  function updateFromText(text) {
    const nextHash = hashContent(text);
    if (nextHash === contentHash) {
      return false;
    }
    diagramContent = text;
    contentHash = nextHash;
    return true;
  }

  async function pushLatestFromDisk(reason, force = false) {
    if (!webviewReady) {
      return;
    }

    let diskText;
    try {
      diskText = await readDiskText();
    } catch {
      return;
    }

    const diskHash = hashContent(diskText);
    if (!force) {
      if (hasUnsavedWebviewEdits) {
        const diskLive = liveElementCountFromJson(diskText);
        const memoryLive = liveElementCountFromJson(diagramContent);
        if (diskLive <= memoryLive) {
          return;
        }
      }
      if (diskHash === contentHash) {
        lastPushedHash = diskHash;
        return;
      }
      if (diskHash === lastPushedHash) {
        return;
      }
    }

    updateFromText(diskText);
    lastPushedHash = diskHash;
    acceptWebviewEdits = true;
    pushToRenderer({
      type: "load",
      content: diagramContent,
      external: reason !== "ready",
    });
  }

  function cancelPendingSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  }

  function markSaved() {
    hasUnsavedWebviewEdits = false;
    lastWebviewSaveHash = contentHash;
    lastPushedHash = lastWebviewSaveHash;
  }

  async function persistToDisk() {
    cancelPendingSave();
    let diskText;
    try {
      diskText = await readDiskText();
    } catch {
      diskText = diagramContent;
    }
    const diskLive = liveElementCountFromJson(diskText);
    const memoryLive = liveElementCountFromJson(diagramContent);
    if (memoryLive < diskLive) {
      updateFromText(diskText);
      lastPushedHash = hashContent(diagramContent);
      hasUnsavedWebviewEdits = false;
      markSaved();
      await pushLatestFromDisk("disk-guard", true);
      return;
    }
    await writeFile(diagramPath, diagramContent, "utf8");
    const fileStat = await stat(diagramPath);
    diagramMtimeMs = fileStat.mtimeMs;
    markSaved();
  }

  function scheduleAutoSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      void persistToDisk();
    }, AUTO_SAVE_DELAY_MS);
  }

  async function handleWebviewChange(content) {
    if (!acceptWebviewEdits) {
      return;
    }
    const incomingLive = liveElementCountFromJson(content);
    const currentLive = liveElementCountFromJson(diagramContent);
    let diskLive = 0;
    try {
      diskLive = liveElementCountFromJson(await readDiskText());
    } catch {
      diskLive = currentLive;
    }
    if (incomingLive === 0 && (currentLive > 0 || diskLive > 0)) {
      return;
    }
    if (incomingLive < diskLive) {
      hasUnsavedWebviewEdits = false;
      await pushLatestFromDisk("change-guard", true);
      return;
    }
    const changed = updateFromText(content);
    if (!changed) {
      return;
    }
    hasUnsavedWebviewEdits = true;
    scheduleAutoSave();
  }

  function requestSelection() {
    return new Promise((resolve, reject) => {
      const requestId = ++selectionRequestId;
      const timer = setTimeout(() => {
        pendingSelection.delete(requestId);
        reject(new Error("Timed out waiting for diagram selection."));
      }, 3000);
      pendingSelection.set(requestId, { resolve, reject, timer });
      pushToRenderer({ type: "getSelection", requestId });
    });
  }

  async function copySelectionReference(silent = false) {
    const selection = await requestSelection();
    if (selection.length === 0) {
      if (!silent) {
        await dialog.showMessageBox({ message: "Select one or more diagram elements first." });
      }
      return;
    }
    const reference = buildSelectionReference(
      diagramPath,
      workspaceRoot,
      diagramContent,
      selection
    );
    clipboard.writeText(reference);
    if (!silent) {
      await dialog.showMessageBox({ message: `Copied: ${reference}` });
    }
  }

  async function handleMessage(message) {
    if (message?.type === "ready") {
      webviewReady = true;
      await pushLatestFromDisk("ready", true);
      return;
    }
    if (message?.type === "pull") {
      await pushLatestFromDisk("pull");
      return;
    }
    if (message?.type === "change" && typeof message.content === "string") {
      await handleWebviewChange(message.content);
      return;
    }
    if (message?.type === "save") {
      await persistToDisk();
      return;
    }
    if (message?.type === "selectionInfo" && typeof message.requestId === "number") {
      const pending = pendingSelection.get(message.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingSelection.delete(message.requestId);
        pending.resolve(Array.isArray(message.elements) ? message.elements : []);
      }
      return;
    }
    if (message?.type === "copySelectionReference") {
      await copySelectionReference(message.silent === true);
    }
  }

  return {
    getDiagramSync() {
      return { path: diagramPath, content: diagramContent };
    },
    async init() {
      diagramContent = await readDiskText();
      contentHash = hashContent(diagramContent);
      lastPushedHash = contentHash;
      lastWebviewSaveHash = contentHash;
      const fileStat = await stat(diagramPath);
      diagramMtimeMs = fileStat.mtimeMs;
    },
    handleMessage,
    pushLatestFromDisk,
    async flushSave() {
      await persistToDisk();
    },
    async dispose() {
      await persistToDisk();
      cancelPendingSave();
    },
    watchDiagram(onChange) {
      watch(diagramPath, { persistent: true }, onChange);
    },
  };
}

function buildSelectionReference(diagramPath, workspaceRoot, fileText, selection) {
  const relativePath = path.relative(workspaceRoot, diagramPath).split(path.sep).join("/");
  const lines = fileText.split("\n");
  const ranges = [];
  for (const element of selection) {
    const idPattern = new RegExp(
      `"id":\\s*"${element.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`
    );
    const idLine = lines.findIndex((line) => idPattern.test(line));
    if (idLine === -1) {
      continue;
    }
    let start = idLine;
    while (start > 0 && !lines[start].includes("{")) {
      start -= 1;
    }
    let depth = 0;
    let end = start;
    for (let i = start; i < lines.length; i += 1) {
      for (const char of lines[i]) {
        if (char === "{") {
          depth += 1;
        } else if (char === "}") {
          depth -= 1;
        }
      }
      end = i;
      if (depth === 0) {
        break;
      }
    }
    ranges.push({ start: start + 1, end: end + 1 });
  }
  if (ranges.length === 0) {
    throw new Error("Could not locate selected elements.");
  }
  ranges.sort((a, b) => a.start - b.start);
  const lineRef = ranges
    .map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`))
    .join(",");
  const names = selection.map((e) => e.label || e.id).filter((v, i, a) => a.indexOf(v) === i);
  return names.length ? `@${relativePath}:${lineRef} · ${names.join(", ")}` : `@${relativePath}:${lineRef}`;
}
