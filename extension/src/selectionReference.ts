import * as path from "node:path";
import * as vscode from "vscode";

export type SelectedElementInfo = {
  id: string;
  type: string;
  label?: string;
};

export function formatElementName(label: string | undefined, id: string, type: string): string {
  const raw = label && label !== id ? label : id;
  const humanized = raw
    .replace(/^(live-)?circle[-_]?(\d+)$/i, "Circle $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();

  if (humanized && humanized !== id) {
    return humanized;
  }

  if (type === "ellipse") {
    return "Shape";
  }
  if (type === "rectangle") {
    return "Box";
  }
  if (type === "arrow") {
    return "Arrow";
  }
  if (type === "text") {
    return "Label";
  }

  return humanized || id;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findElementLineRange(
  fileText: string,
  elementId: string
): { start: number; end: number } | undefined {
  const lines = fileText.split("\n");
  const idPattern = new RegExp(`"id":\\s*"${escapeRegex(elementId)}"`);
  let idLine = -1;

  for (let i = 0; i < lines.length; i++) {
    if (idPattern.test(lines[i])) {
      idLine = i;
      break;
    }
  }

  if (idLine === -1) {
    return undefined;
  }

  let start = idLine;
  while (start > 0 && !lines[start].includes("{")) {
    start--;
  }

  let depth = 0;
  let end = start;
  for (let i = start; i < lines.length; i++) {
    for (const char of lines[i]) {
      if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
      }
    }
    end = i;
    if (depth === 0) {
      break;
    }
  }

  return { start: start + 1, end: end + 1 };
}

function workspaceRelativePath(uri: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder) {
    return path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/");
  }
  return path.basename(uri.fsPath);
}

export function buildSelectionReference(
  uri: vscode.Uri,
  fileText: string,
  selection: SelectedElementInfo[]
): string {
  const relativePath = workspaceRelativePath(uri);
  const ranges: Array<{ start: number; end: number }> = [];

  for (const element of selection) {
    const range = findElementLineRange(fileText, element.id);
    if (range) {
      ranges.push(range);
    }
  }

  if (ranges.length === 0) {
    throw new Error("Could not locate selected elements in the file.");
  }

  ranges.sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end + 1) {
      merged.push({ ...range });
      continue;
    }
    last.end = Math.max(last.end, range.end);
  }

  const lineRef = merged
    .map((range) => (range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`))
    .join(",");

  const names = selection
    .map((element) => formatElementName(element.label, element.id, element.type))
    .filter((value, index, array) => array.indexOf(value) === index);

  const base = `@${relativePath}:${lineRef}`;
  if (names.length === 0) {
    return base;
  }

  return `${base} · ${names.join(", ")}`;
}
