import { clipboard, dialog } from "electron";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, watch } from "node:fs";
import { mkdir, readFile, readdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const DESIGN_GROUPS_DIR = ".designs/groups";
const DESIGNS_ROOT_DIR = ".designs";
const DESIGN_GROUP_EXTENSION = ".excalidraw-group.json";
const AUTO_SAVE_DELAY_MS = 300;
const encoder = new TextEncoder();

function hashContent(text) {
  return createHash("sha256").update(encoder.encode(text)).digest("hex");
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
  let lastPushedHash = "";
  let lastWebviewSaveHash = "";
  let saveTimer = null;
  let selectionRequestId = 0;
  const pendingSelection = new Map();
  const pendingSelectionElements = new Map();

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
    if (!force && diskHash === lastPushedHash) {
      return;
    }

    updateFromText(diskText);
    lastPushedHash = diskHash;
    acceptWebviewEdits = true;
    pushToRenderer({ type: "load", content: diagramContent });
  }

  function cancelPendingSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  }

  function markSaved() {
    lastWebviewSaveHash = contentHash;
    lastPushedHash = lastWebviewSaveHash;
  }

  async function persistToDisk() {
    cancelPendingSave();
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
    const changed = updateFromText(content);
    if (!changed) {
      return;
    }
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

  function requestSelectionElements() {
    return new Promise((resolve, reject) => {
      const requestId = ++selectionRequestId;
      const timer = setTimeout(() => {
        pendingSelectionElements.delete(requestId);
        reject(new Error("Timed out waiting for diagram selection."));
      }, 3000);
      pendingSelectionElements.set(requestId, { resolve, reject, timer });
      pushToRenderer({ type: "getSelectionElements", requestId });
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

  async function saveSelectionAsDesign() {
    const { elements, files } = await requestSelectionElements();
    if (elements.length === 0) {
      await dialog.showMessageBox({ message: "Select one or more diagram elements first." });
      return;
    }

    const consent = await dialog.showMessageBox({
      type: "question",
      buttons: ["Create .designs/", "Cancel"],
      message: "Create `.designs/` in this repo for reusable diagram groups?",
    });
    if (consent.response !== 0) {
      return;
    }

    const name = await promptInput("Design name", "Auth Stack");
    if (!name) {
      return;
    }

    const slug = slugify(name);
    const filePath = path.join(workspaceRoot, DESIGN_GROUPS_DIR, `${slug}${DESIGN_GROUP_EXTENSION}`);
    if (existsSync(filePath)) {
      const overwrite = await dialog.showMessageBox({
        type: "warning",
        buttons: ["Overwrite", "Cancel"],
        message: `Design "${name}" already exists. Overwrite?`,
      });
      if (overwrite.response !== 0) {
        return;
      }
    }

    const description = await promptInput("Optional description", "");
    await saveDesignGroup(workspaceRoot, name, description || undefined, elements, files);
    await dialog.showMessageBox({ message: `Saved design "${name.trim()}"` });
  }

  async function insertDesignFromRepo() {
    const designs = await listSavedDesigns(workspaceRoot);
    if (designs.length === 0) {
      await dialog.showMessageBox({
        message: "No saved designs yet. Select elements and use Save Design.",
      });
      return;
    }

    const pick = await dialog.showMessageBox({
      type: "question",
      message: "Insert design from repository",
      buttons: [...designs.map((d) => d.name), "Cancel"],
      cancelId: designs.length,
    });
    if (pick.response >= designs.length) {
      return;
    }

    const design = designs[pick.response];
    const saved = await loadDesignGroup(design.filePath);
    const slug = design.fileName.replace(/\.excalidraw-group\.json$/, "");
    pushToRenderer({
      type: "insertDesign",
      designSlug: slug,
      elements: saved.group.elements,
      files: saved.group.files ?? {},
      bounds: saved.bounds,
    });
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
    if (message?.type === "selectionElements" && typeof message.requestId === "number") {
      const pending = pendingSelectionElements.get(message.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingSelectionElements.delete(message.requestId);
        pending.resolve({
          elements: Array.isArray(message.elements) ? message.elements : [],
          files:
            typeof message.files === "object" && message.files !== null ? message.files : {},
        });
      }
      return;
    }
    if (message?.type === "copySelectionReference") {
      await copySelectionReference(message.silent === true);
      return;
    }
    if (message?.type === "appletSaveDesign") {
      await saveSelectionAsDesign();
      return;
    }
    if (message?.type === "appletInsertDesign") {
      await insertDesignFromRepo();
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

async function promptInput(title, defaultValue = "") {
  if (process.platform === "darwin") {
    const escapedTitle = title.replace(/"/g, '\\"');
    const escapedDefault = defaultValue.replace(/"/g, '\\"');
    try {
      const out = execSync(
        `osascript -e 'text returned of (display dialog "${escapedTitle}" default answer "${escapedDefault}")'`,
        { encoding: "utf8" }
      ).trim();
      return out || null;
    } catch {
      return null;
    }
  }
  return defaultValue || null;
}

function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizeGroupElements(elements) {
  if (elements.length === 0) {
    return { elements: [], bounds: { x: 0, y: 0, width: 0, height: 0 } };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const raw of elements) {
    const el = raw;
    const x = el.x ?? 0;
    const y = el.y ?? 0;
    const w = el.width ?? 0;
    const h = el.height ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  const normalized = elements.map((raw) => {
    const el = { ...raw };
    if (typeof el.x === "number") {
      el.x -= minX;
    }
    if (typeof el.y === "number") {
      el.y -= minY;
    }
    return el;
  });
  return {
    elements: normalized,
    bounds: { x: 0, y: 0, width: maxX - minX, height: maxY - minY },
  };
}

async function saveDesignGroup(workspaceRoot, name, description, elements, files) {
  const slug = slugify(name);
  if (!slug) {
    throw new Error("Design name must contain letters or numbers.");
  }
  await mkdir(path.join(workspaceRoot, DESIGNS_ROOT_DIR), { recursive: true });
  await mkdir(path.join(workspaceRoot, DESIGN_GROUPS_DIR), { recursive: true });
  const filePath = path.join(workspaceRoot, DESIGN_GROUPS_DIR, `${slug}${DESIGN_GROUP_EXTENSION}`);
  const { elements: normalizedElements, bounds } = normalizeGroupElements(elements);
  let created = new Date().toISOString();
  try {
    const existing = JSON.parse(await readFile(filePath, "utf8"));
    created = existing.created ?? created;
  } catch {
    // new file
  }
  const payload = {
    type: "excalidraw-group",
    name: name.trim(),
    description,
    created,
    updated: new Date().toISOString(),
    bounds,
    group: {
      type: "excalidraw",
      version: 2,
      source: path.relative(workspaceRoot, filePath).split(path.sep).join("/"),
      elements: normalizedElements,
      files,
    },
  };
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function listSavedDesigns(workspaceRoot) {
  const dir = path.join(workspaceRoot, DESIGN_GROUPS_DIR);
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const summaries = [];
  for (const fileName of entries) {
    if (!fileName.endsWith(DESIGN_GROUP_EXTENSION)) {
      continue;
    }
    const filePath = path.join(dir, fileName);
    try {
      const design = JSON.parse(await readFile(filePath, "utf8"));
      summaries.push({
        name: design.name ?? fileName.replace(DESIGN_GROUP_EXTENSION, ""),
        description: design.description,
        fileName,
        filePath,
      });
    } catch {
      summaries.push({
        name: fileName.replace(DESIGN_GROUP_EXTENSION, ""),
        fileName,
        filePath,
      });
    }
  }
  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}

async function loadDesignGroup(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
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
