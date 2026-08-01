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
    JSON.parse(trimmed);
    return true;
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
