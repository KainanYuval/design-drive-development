import { serializeAsJSON } from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles, ExcalidrawElement } from "@excalidraw/excalidraw/types";

declare global {
  interface Window {
    acquireVsCodeApi?: () => {
      postMessage(message: unknown): void;
    };
  }
}

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
};

function resolveHost() {
  if (typeof window !== "undefined" && typeof window.acquireVsCodeApi === "function") {
    return window.acquireVsCodeApi();
  }

  if (typeof acquireVsCodeApi === "function") {
    return acquireVsCodeApi();
  }

  return { postMessage(_message: unknown) {} };
}

export const vscode = resolveHost();

export function sendDocumentChange(
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
  basedOnGeneration: number
): void {
  const json = serializeAsJSON(elements, appState, files, "local");
  vscode.postMessage({
    type: "change",
    content: json,
    basedOnGeneration,
  });
}
