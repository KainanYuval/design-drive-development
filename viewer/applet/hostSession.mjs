import { clipboard, dialog } from "electron";
import { createHash } from "node:crypto";
import { existsSync, watch } from "node:fs";
import { open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const AUTO_SAVE_DELAY_MS = 300;
const encoder = new TextEncoder();
const require = createRequire(import.meta.url);
const { SyncCoordinator } = require("../../extension/out/syncCoordinator.js");
const {
  agentTurnLockPath,
  readAgentTurnLockSync,
  AGENT_TURN_WATCH_DEBOUNCE_MS,
  WATCH_DEBOUNCE_MS,
} = require("../../extension/out/agentTurn.js");
const EMPTY_EXCALIDRAW_JSON = JSON.stringify(
  {
    type: "excalidraw",
    version: 2,
    source: "design-drive-development",
    elements: [],
    appState: {
      gridSize: 20,
      viewBackgroundColor: "#ffffff",
    },
    files: {},
  },
  null,
  2
);

function hashContent(text) {
  return createHash("sha256").update(encoder.encode(text)).digest("hex");
}

function isValidDiagramJson(text) {
  if (!text.trim()) {
    return false;
  }
  try {
    const parsed = JSON.parse(text);
    return (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      parsed.type === "excalidraw" &&
      Array.isArray(parsed.elements) &&
      parsed.files !== null &&
      typeof parsed.files === "object" &&
      !Array.isArray(parsed.files)
    );
  } catch {
    return false;
  }
}

function normalizeDiagramText(text) {
  return isValidDiagramJson(text) ? text : EMPTY_EXCALIDRAW_JSON;
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
  let webviewReady = false;
  let acceptWebviewEdits = false;
  let sync = null;
  let saveTimer = null;
  let tempSequence = 0;
  let diagramWatcher = null;
  let agentTurnActive = false;
  let reloadDelayMs = WATCH_DEBOUNCE_MS;
  let observationQueue = Promise.resolve();
  let selectionRequestId = 0;
  const contentByHash = new Map();
  const pendingLoadContent = new Map();
  const pendingSelection = new Map();

  async function readDiskText() {
    return readFile(diagramPath, "utf8");
  }

  async function atomicReplaceIfDiskHash(expectedDiskHash, content) {
    const lockPath = `${diagramPath}.ddd-write.lock`;
    const lock = await acquireWriteLock(lockPath);
    try {
      let current = await readDiskText();
      if (hashContent(current) !== expectedDiskHash) {
        return { saved: false, content: current };
      }

      const tempPath = `${diagramPath}.ddd-${process.pid}-${Date.now()}-${++tempSequence}.tmp`;
      await writeFile(tempPath, content, "utf8");
      try {
        current = await readDiskText();
        if (hashContent(current) !== expectedDiskHash) {
          return { saved: false, content: current };
        }
        if (process.platform === "win32") {
          await writeFile(diagramPath, content, "utf8");
          await unlink(tempPath).catch(() => undefined);
        } else {
          await rename(tempPath, diagramPath);
        }
        return { saved: true };
      } finally {
        await unlink(tempPath).catch(() => undefined);
      }
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }

  async function acquireWriteLock(lockPath) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const handle = await open(lockPath, "wx");
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })
        );
        return handle;
      } catch (error) {
        if (error?.code !== "EEXIST") {
          throw error;
        }
        try {
          const info = await stat(lockPath);
          if (Date.now() - info.mtimeMs > 30_000) {
            await unlink(lockPath);
            continue;
          }
        } catch {
          continue;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    throw new Error(`Timed out waiting for diagram write lock: ${lockPath}`);
  }

  async function readNormalizedDisk(seedEmpty = false) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const rawText = await readDiskText();
      if (isValidDiagramJson(rawText)) {
        return { text: rawText, hash: hashContent(rawText) };
      }
      if (!seedEmpty || rawText.trim().length > 0) {
        return null;
      }
      const normalized = await atomicReplaceIfDiskHash(
        hashContent(rawText),
        EMPTY_EXCALIDRAW_JSON
      );
      if (normalized.saved) {
        return {
          text: EMPTY_EXCALIDRAW_JSON,
          hash: hashContent(EMPTY_EXCALIDRAW_JSON),
        };
      }
    }
    throw new Error("Diagram changed repeatedly while normalizing.");
  }

  function setDiagramContent(text) {
    const normalized = normalizeDiagramText(text);
    const nextHash = hashContent(normalized);
    contentByHash.set(nextHash, normalized);
    if (nextHash === contentHash) {
      return false;
    }
    diagramContent = normalized;
    contentHash = nextHash;
    return true;
  }

  async function refreshAgentTurnState(reason) {
    const lock = readAgentTurnLockSync(diagramPath);
    if (lock && !agentTurnActive) {
      agentTurnActive = true;
      sync?.beginAgentTurn();
      cancelPendingSave();
      acceptWebviewEdits = false;
      reloadDelayMs = AGENT_TURN_WATCH_DEBOUNCE_MS;
      pushToRenderer({
        type: "agentTurn",
        active: true,
        label: lock.label ?? "Agent turn",
      });
      await pushLatestFromDisk(`${reason}-agent-turn-start`, true);
      return;
    }
    if (!lock && agentTurnActive) {
      agentTurnActive = false;
      sync?.endAgentTurn();
      reloadDelayMs = WATCH_DEBOUNCE_MS;
      pushToRenderer({ type: "agentTurn", active: false });
      await pushLatestFromDisk(`${reason}-agent-turn-end`, true);
      return;
    }
    if (lock && agentTurnActive) {
      pushToRenderer({
        type: "agentTurn",
        active: true,
        label: lock.label ?? "Agent turn",
      });
    }
  }

  async function pushLatestFromDiskNow(reason, force = false) {
    if (!webviewReady || !sync) {
      return;
    }

    await refreshAgentTurnState(reason);

    const disk = await readNormalizedDisk(reason === "ready");
    if (!disk) {
      if (reason === "ready") {
        await executeSyncEffects(sync.bootstrap(contentHash));
      }
      return;
    }
    contentByHash.set(disk.hash, disk.text);
    const effects =
      reason === "ready"
        ? sync.bootstrap(disk.hash)
        : force
          ? sync.acceptExternal(disk.hash)
          : sync.diskObserved(disk.hash);
    await executeSyncEffects(effects);
  }

  function pushLatestFromDisk(reason, force = false) {
    const operation = observationQueue.then(() =>
      pushLatestFromDiskNow(reason, force)
    );
    observationQueue = operation.catch((error) => {
      console.error(`Failed to sync ${path.basename(diagramPath)}:`, error);
    });
    return operation;
  }

  function cancelPendingSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  }

  async function persistToDisk() {
    cancelPendingSave();
    if (!sync) {
      return;
    }
    const [effect] = sync.requestHumanSave();
    if (!effect || effect.type !== "saveHuman") {
      return;
    }
    try {
      await performHumanSave(effect);
    } catch (error) {
      sync.humanSaveFailed();
      scheduleAutoSave();
      throw error;
    }
  }

  function scheduleAutoSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      void persistToDisk().catch((error) => {
        console.error(`Failed to save ${path.basename(diagramPath)}:`, error);
      });
    }, AUTO_SAVE_DELAY_MS);
  }

  async function handleWebviewChange(content, basedOnGeneration) {
    if (!acceptWebviewEdits || !sync || agentTurnActive) {
      return;
    }
    const before = sync.snapshot();
    if (basedOnGeneration !== before.generation) {
      if (
        before.phase === "applyingAgent" &&
        basedOnGeneration < before.generation &&
        before.awaitingHash
      ) {
        if (setDiagramContent(content)) {
          pushToRenderer({
            type: "cancelLoad",
            generation: before.generation,
          });
          pushToRenderer({
            type: "adoptGeneration",
            generation: before.generation,
          });
          sync.canvasChanged(contentHash);
          await executeSyncEffects(sync.diskObserved(before.awaitingHash));
        }
      }
      return;
    }
    const changed = setDiagramContent(content);
    if (!changed) {
      return;
    }
    sync.canvasChanged(contentHash);
    scheduleAutoSave();
  }

  function applyWebviewLoad(generation, appliedHash) {
    if (!sync?.loadApplied(generation, appliedHash)) {
      return;
    }
    const content =
      pendingLoadContent.get(generation) ?? contentByHash.get(appliedHash);
    if (content) {
      setDiagramContent(content);
    }
    for (const pendingGeneration of pendingLoadContent.keys()) {
      if (pendingGeneration <= generation) {
        pendingLoadContent.delete(pendingGeneration);
      }
    }
    acceptWebviewEdits = !agentTurnActive;
  }

  async function executeSyncEffects(effects) {
    for (const effect of effects) {
      if (effect.type === "loadCanvas") {
        const content = contentByHash.get(effect.hash);
        if (!content) {
          continue;
        }
        pendingLoadContent.set(effect.generation, content);
        pushToRenderer({
          type: "load",
          content,
          external: effect.origin !== "initial",
          generation: effect.generation,
          hash: effect.hash,
          origin: effect.origin,
          agentTurn: agentTurnActive,
        });
        continue;
      }
      if (effect.type === "preserveConflict") {
        await preserveAgentConflict(effect);
        cancelPendingSave();
        await persistToDisk();
        continue;
      }
      if (effect.type === "saveHuman") {
        await performHumanSave(effect);
      }
    }
  }

  async function performHumanSave(effect) {
    const humanContent =
      contentByHash.get(effect.humanHash) ??
      (contentHash === effect.humanHash ? diagramContent : undefined);
    if (!humanContent) {
      sync.humanSaveFailed();
      return;
    }

    for (;;) {
      const disk = await readNormalizedDisk();
      if (!disk) {
        sync.humanSaveFailed();
        return;
      }
      contentByHash.set(disk.hash, disk.text);
      if (disk.hash !== effect.expectedDiskHash) {
        await executeSyncEffects(sync.humanSaveLostRace(disk.hash));
        return;
      }

      const result = await atomicReplaceIfDiskHash(
        effect.expectedDiskHash,
        humanContent
      );
      if (!result.saved) {
        continue;
      }

      sync.humanSaveSucceeded(effect.humanHash);
      if (sync.snapshot().phase === "humanDirty") {
        scheduleAutoSave();
      }
      return;
    }
  }

  async function preserveAgentConflict(effect) {
    const agentContent = contentByHash.get(effect.agentHash);
    if (!agentContent) {
      return;
    }
    const ext = path.extname(diagramPath);
    const base = diagramPath.slice(0, diagramPath.length - ext.length);
    const candidatePath = `${base}.agent-conflict${ext}`;
    const metadataPath = `${base}.agent-conflict.json`;
    await writeFile(candidatePath, agentContent, "utf8");
    await writeFile(
      metadataPath,
      JSON.stringify(
        {
          diagram: path.basename(diagramPath),
          createdAt: new Date().toISOString(),
          baseHash: effect.baseHash,
          humanHash: effect.humanHash,
          agentHash: effect.agentHash,
          policy: "human-open-session-wins",
          candidate: path.basename(candidatePath),
        },
        null,
        2
      ),
      "utf8"
    );
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
    if (
      message?.type === "loadApplied" &&
      typeof message.generation === "number" &&
      typeof message.appliedHash === "string"
    ) {
      applyWebviewLoad(message.generation, message.appliedHash);
      return;
    }
    if (message?.type === "change" && typeof message.content === "string") {
      await handleWebviewChange(
        message.content,
        typeof message.basedOnGeneration === "number"
          ? message.basedOnGeneration
          : -1
      );
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
      const disk = await readNormalizedDisk(true);
      diagramContent = disk?.text ?? EMPTY_EXCALIDRAW_JSON;
      contentHash = hashContent(diagramContent);
      contentByHash.set(contentHash, diagramContent);
      sync = new SyncCoordinator(contentHash);
    },
    handleMessage,
    pushLatestFromDisk,
    getReloadDelayMs() {
      return reloadDelayMs;
    },
    async flushSave() {
      await persistToDisk();
    },
    async dispose() {
      await persistToDisk();
      cancelPendingSave();
      diagramWatcher?.close();
      diagramWatcher = null;
    },
    watchDiagram(onChange) {
      diagramWatcher?.close();
      const fileName = path.basename(diagramPath);
      const lockName = path.basename(agentTurnLockPath(diagramPath));
      diagramWatcher = watch(path.dirname(diagramPath), { persistent: true }, (_event, changed) => {
        const name = changed?.toString();
        if (!name || name === fileName || name === lockName) {
          onChange();
        }
      });
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
