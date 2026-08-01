/** Valid empty diagram JSON for new / corrupt *.excalidraw files. */
export const EMPTY_EXCALIDRAW_JSON = JSON.stringify(
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

export function isValidDiagramJson(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed) as {
      type?: unknown;
      elements?: unknown;
      files?: unknown;
    } | null;
    return (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      parsed.type === "excalidraw" &&
      Array.isArray(parsed.elements) &&
      typeof parsed.files === "object" &&
      parsed.files !== null &&
      !Array.isArray(parsed.files)
    );
  } catch {
    return false;
  }
}

export function normalizeDiagramText(raw: string): string {
  if (!isValidDiagramJson(raw)) {
    return EMPTY_EXCALIDRAW_JSON;
  }
  return raw;
}

export function classifyDiagramText(
  raw: string
): "empty" | "valid" | "invalid" {
  if (raw.trim().length === 0) {
    return "empty";
  }
  return isValidDiagramJson(raw) ? "valid" : "invalid";
}
