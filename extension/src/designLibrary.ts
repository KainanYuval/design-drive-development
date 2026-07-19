import * as path from "node:path";
import * as vscode from "vscode";
import { DESIGN_GROUPS_DIR, DESIGNS_ROOT_DIR } from "./designsConsent";

export { DESIGN_GROUPS_DIR, DESIGNS_ROOT_DIR } from "./designsConsent";
export const DESIGN_GROUP_EXTENSION = ".excalidraw-group.json";

export type GroupBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ExcalidrawGroupPayload = {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: unknown[];
  files: Record<string, unknown>;
};

export type SavedDesign = {
  type: "excalidraw-group";
  name: string;
  description?: string;
  created: string;
  updated: string;
  bounds: GroupBounds;
  group: ExcalidrawGroupPayload;
};

export type SavedDesignSummary = {
  name: string;
  description?: string;
  fileName: string;
  uri: vscode.Uri;
};

type ElementLike = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  points?: number[][];
};

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function elementBounds(element: ElementLike): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const x = element.x ?? 0;
  const y = element.y ?? 0;
  const width = element.width ?? 0;
  const height = element.height ?? 0;
  let minX = x;
  let minY = y;
  let maxX = x + width;
  let maxY = y + height;

  if (Array.isArray(element.points)) {
    for (const point of element.points) {
      if (!Array.isArray(point) || point.length < 2) {
        continue;
      }
      const px = x + point[0];
      const py = y + point[1];
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
  }

  return { minX, minY, maxX, maxY };
}

export function normalizeGroupElements(elements: unknown[]): {
  elements: unknown[];
  bounds: GroupBounds;
} {
  if (elements.length === 0) {
    return {
      elements: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const raw of elements) {
    const bounds = elementBounds(raw as ElementLike);
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }

  if (!Number.isFinite(minX)) {
    return {
      elements,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    };
  }

  const normalized = elements.map((raw) => {
    const element = { ...(raw as Record<string, unknown>) };
    if (typeof element.x === "number") {
      element.x = element.x - minX;
    }
    if (typeof element.y === "number") {
      element.y = element.y - minY;
    }
    return element;
  });

  return {
    elements: normalized,
    bounds: {
      x: 0,
      y: 0,
      width: maxX - minX,
      height: maxY - minY,
    },
  };
}

export function getDesignGroupsDirectory(folder: vscode.WorkspaceFolder): vscode.Uri {
  return vscode.Uri.joinPath(folder.uri, DESIGN_GROUPS_DIR);
}

export function designGroupUriForName(
  folder: vscode.WorkspaceFolder,
  name: string
): vscode.Uri {
  const slug = slugify(name);
  if (!slug) {
    throw new Error("Design name must contain letters or numbers.");
  }

  return vscode.Uri.joinPath(
    folder.uri,
    DESIGN_GROUPS_DIR,
    `${slug}${DESIGN_GROUP_EXTENSION}`
  );
}

export async function loadExistingDesignGroup(
  uri: vscode.Uri
): Promise<SavedDesign | undefined> {
  try {
    return await loadDesignGroup(uri);
  } catch {
    return undefined;
  }
}

export async function confirmDesignOverwrite(
  name: string,
  existing: SavedDesign
): Promise<boolean> {
  const existingLabel = existing.name?.trim() || "existing design";
  const answer = await vscode.window.showWarningMessage(
    `Saved design "${existingLabel}" already exists at this name. Overwrite it with the current selection?`,
    { modal: true },
    "Overwrite",
    "Cancel"
  );

  return answer === "Overwrite";
}

export async function ensureDesignGroupsDirectory(
  folder: vscode.WorkspaceFolder
): Promise<vscode.Uri> {
  const root = vscode.Uri.joinPath(folder.uri, DESIGNS_ROOT_DIR);
  const dir = getDesignGroupsDirectory(folder);
  try {
    await vscode.workspace.fs.createDirectory(root);
    await vscode.workspace.fs.createDirectory(dir);
  } catch {
    // Directories may already exist.
  }
  return dir;
}

export async function listSavedDesigns(
  folder: vscode.WorkspaceFolder
): Promise<SavedDesignSummary[]> {
  const dir = getDesignGroupsDirectory(folder);
  let entries: [string, vscode.FileType][];

  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return [];
  }

  const summaries: SavedDesignSummary[] = [];

  for (const [name, type] of entries) {
    if (type !== vscode.FileType.File || !name.endsWith(DESIGN_GROUP_EXTENSION)) {
      continue;
    }

    const uri = vscode.Uri.joinPath(dir, name);
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const design = JSON.parse(Buffer.from(raw).toString("utf8")) as SavedDesign;
      summaries.push({
        name: design.name ?? name.replace(DESIGN_GROUP_EXTENSION, ""),
        description: design.description,
        fileName: name,
        uri,
      });
    } catch {
      summaries.push({
        name: name.replace(DESIGN_GROUP_EXTENSION, ""),
        uri,
        fileName: name,
      });
    }
  }

  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveDesignGroup(
  folder: vscode.WorkspaceFolder,
  name: string,
  description: string | undefined,
  elements: unknown[],
  files: Record<string, unknown>
): Promise<vscode.Uri> {
  const slug = slugify(name);
  if (!slug) {
    throw new Error("Design name must contain letters or numbers.");
  }

  await ensureDesignGroupsDirectory(folder);
  const uri = vscode.Uri.joinPath(
    folder.uri,
    DESIGN_GROUPS_DIR,
    `${slug}${DESIGN_GROUP_EXTENSION}`
  );
  const relativeSource = designReferencePath(uri);
  const { elements: normalizedElements, bounds } = normalizeGroupElements(elements);

  let created = new Date().toISOString();
  try {
    const existing = await vscode.workspace.fs.readFile(uri);
    const parsed = JSON.parse(Buffer.from(existing).toString("utf8")) as SavedDesign;
    created = parsed.created ?? created;
  } catch {
    // New design file.
  }

  const payload: SavedDesign = {
    type: "excalidraw-group",
    name: name.trim(),
    description: description?.trim() || undefined,
    created,
    updated: new Date().toISOString(),
    bounds,
    group: {
      type: "excalidraw",
      version: 2,
      source: relativeSource,
      elements: normalizedElements,
      files,
    },
  };

  await vscode.workspace.fs.writeFile(
    uri,
    Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8")
  );

  return uri;
}

export async function loadDesignGroup(uri: vscode.Uri): Promise<SavedDesign> {
  const raw = await vscode.workspace.fs.readFile(uri);
  const parsed = JSON.parse(Buffer.from(raw).toString("utf8")) as SavedDesign & {
    elements?: unknown[];
    files?: Record<string, unknown>;
  };

  if (parsed.type === "excalidraw-group" && parsed.group?.elements) {
    return parsed;
  }

  // Legacy flat format migration on read.
  const legacyElements = parsed.elements ?? parsed.group?.elements ?? [];
  const legacyFiles = parsed.files ?? parsed.group?.files ?? {};
  const { elements, bounds } = normalizeGroupElements(legacyElements);

  return {
    type: "excalidraw-group",
    name: parsed.name ?? path.basename(uri.fsPath, DESIGN_GROUP_EXTENSION),
    description: parsed.description,
    created: parsed.created ?? new Date().toISOString(),
    updated: parsed.updated ?? new Date().toISOString(),
    bounds: parsed.bounds ?? bounds,
    group: {
      type: "excalidraw",
      version: 2,
      source: designReferencePath(uri),
      elements,
      files: legacyFiles,
    },
  };
}

export function designReferencePath(uri: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder) {
    return path
      .relative(folder.uri.fsPath, uri.fsPath)
      .split(path.sep)
      .join("/");
  }
  return path.basename(uri.fsPath);
}

export function getDesignElements(design: SavedDesign): unknown[] {
  return design.group.elements;
}

export function getDesignFiles(design: SavedDesign): Record<string, unknown> {
  return design.group.files ?? {};
}
