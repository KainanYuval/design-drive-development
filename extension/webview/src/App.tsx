import { CaptureUpdateAction, Excalidraw, getSceneVersion } from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawElement,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cloneDesignElements, designInsertOffset } from "./designElements";
import { sendDocumentChange, vscode } from "./vscode";

declare global {
  interface Window {
    __DDD_APPLET__?: boolean;
    __DDD_INITIAL_DIAGRAM__?: { path: string; content: string };
  }
}

type ExcalidrawPayload = {
  elements: ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
};

type SelectionInfo = {
  id: string;
  type: string;
  label?: string;
};

function parsePayload(raw: string): ExcalidrawPayload {
  const parsed = JSON.parse(raw) as {
    elements?: ExcalidrawElement[];
    appState?: Partial<AppState>;
    files?: BinaryFiles;
  };

  return {
    elements: parsed.elements ?? [],
    appState: parsed.appState ?? {},
    files: parsed.files ?? {},
  };
}

function preserveViewState(
  incoming: Partial<AppState>,
  current: Partial<AppState>
): Partial<AppState> {
  return {
    ...incoming,
    viewModeEnabled: false,
    scrollX: current.scrollX ?? incoming.scrollX,
    scrollY: current.scrollY ?? incoming.scrollY,
    zoom: current.zoom ?? incoming.zoom,
  };
}

function elementLabel(element: ExcalidrawElement, elements: ExcalidrawElement[]): string {
  if (element.type === "text" && "text" in element && typeof element.text === "string") {
    return element.text;
  }

  const boundLabel = elements.find(
    (candidate) =>
      candidate.type === "text" &&
      "containerId" in candidate &&
      candidate.containerId === element.id &&
      "text" in candidate &&
      typeof candidate.text === "string"
  );

  if (boundLabel && "text" in boundLabel && typeof boundLabel.text === "string") {
    return boundLabel.text;
  }

  return element.id;
}

function collectSelection(api: ExcalidrawImperativeAPI): SelectionInfo[] {
  const appState = api.getAppState();
  const elements = api.getSceneElements();
  const selectedIds = Object.keys(appState.selectedElementIds ?? {});

  return selectedIds
    .map((id) => elements.find((element) => element.id === id))
    .filter((element): element is ExcalidrawElement => element !== undefined)
    .map((element) => ({
      id: element.id,
      type: element.type,
      label: elementLabel(element, elements),
    }));
}

function collectSelectionElements(api: ExcalidrawImperativeAPI): {
  elements: ExcalidrawElement[];
  files: BinaryFiles;
} {
  const appState = api.getAppState();
  const elements = api.getSceneElements();
  const files = api.getFiles();
  const selectedIds = new Set(Object.keys(appState.selectedElementIds ?? {}));
  const selectedElements = elements.filter((element) => selectedIds.has(element.id));

  const selectedFiles: BinaryFiles = {};
  for (const element of selectedElements) {
    if ("fileId" in element && typeof element.fileId === "string" && files[element.fileId]) {
      selectedFiles[element.fileId] = files[element.fileId];
    }
  }

  return { elements: selectedElements, files: selectedFiles };
}

function viewportCenter(appState: Partial<AppState>): { centerX: number; centerY: number } {
  const zoom = appState.zoom ?? 1;
  const width = appState.width ?? 800;
  const height = appState.height ?? 600;
  return {
    centerX: (width / 2 - (appState.scrollX ?? 0)) / zoom,
    centerY: (height / 2 - (appState.scrollY ?? 0)) / zoom,
  };
}

function sceneFingerprint(
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles
): string {
  return JSON.stringify({ elements, files });
}

function liveElementCount(elements: readonly ExcalidrawElement[]): number {
  return elements.filter((element) => !element.isDeleted).length;
}

export function App(): JSX.Element {
  const initial = window.__DDD_INITIAL_DIAGRAM__;
  const [payload, setPayload] = useState<ExcalidrawPayload | null>(() => {
    if (!initial?.content) {
      return null;
    }
    return parsePayload(initial.content);
  });
  const suppressChangeUntil = useRef(0);
  const latestAppState = useRef<Partial<AppState>>({});
  const latestElements = useRef<ExcalidrawElement[]>([]);
  const latestFiles = useRef<BinaryFiles>({});
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const lastPersistedScene = useRef("");
  const diagramReadySent = useRef(false);
  const isPointerDown = useRef(false);
  const pendingExternalLoad = useRef<string | null>(null);
  const readyToPersist = useRef(false);
  const lastPersistedLiveCount = useRef(0);
  const persistReadyTimer = useRef<number | null>(null);

  const excalidrawInitialData = useMemo(() => {
    if (!payload) {
      return undefined;
    }
    return {
      elements: payload.elements,
      files: payload.files,
      appState: {
        ...payload.appState,
        viewModeEnabled: false,
      },
    };
  }, [payload]);

  const schedulePersistReady = useCallback((api: ExcalidrawImperativeAPI) => {
    readyToPersist.current = false;
    if (persistReadyTimer.current !== null) {
      window.clearTimeout(persistReadyTimer.current);
    }
    persistReadyTimer.current = window.setTimeout(() => {
      const elements = api.getSceneElements();
      const files = api.getFiles();
      lastPersistedScene.current = sceneFingerprint(elements, files);
      lastPersistedLiveCount.current = liveElementCount(elements);
      latestElements.current = [...elements];
      latestFiles.current = { ...files };
      readyToPersist.current = true;
      persistReadyTimer.current = null;
    }, 100);
  }, []);

  useEffect(() => {
    if (!payload || diagramReadySent.current || !window.__DDD_APPLET__) {
      return;
    }
    diagramReadySent.current = true;
    vscode.postMessage({ type: "timing", phase: "diagram-render" });
  }, [payload]);

  const applyExternalPayload = useCallback((raw: string, external = true) => {
    const parsed = parsePayload(raw);
    const nextFingerprint = sceneFingerprint(parsed.elements, parsed.files);
    if (nextFingerprint === lastPersistedScene.current) {
      return;
    }

    const currentElements = apiRef.current?.getSceneElements() ?? latestElements.current;
    if (external) {
      if (isPointerDown.current) {
        pendingExternalLoad.current = raw;
        return;
      }

      const incomingLive = liveElementCount(parsed.elements);
      const currentLive = liveElementCount(currentElements);
      if (
        incomingLive < currentLive ||
        getSceneVersion(parsed.elements) < getSceneVersion(currentElements)
      ) {
        return;
      }
    }

    if (external) {
      suppressChangeUntil.current = Date.now() + 400;
    } else {
      suppressChangeUntil.current = Date.now() + 500;
    }

    latestElements.current = parsed.elements;
    latestFiles.current = parsed.files;
    lastPersistedScene.current = nextFingerprint;
    lastPersistedLiveCount.current = liveElementCount(parsed.elements);

    const api = apiRef.current;
    if (api) {
      readyToPersist.current = false;
      api.updateScene({
        elements: parsed.elements,
        files: parsed.files,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      schedulePersistReady(api);
      return;
    }

    readyToPersist.current = false;
    setPayload({
      elements: parsed.elements,
      appState: preserveViewState(parsed.appState, latestAppState.current),
      files: parsed.files,
    });
  }, [schedulePersistReady]);

  const flushPendingExternalLoad = useCallback(() => {
    const raw = pendingExternalLoad.current;
    if (!raw) {
      return;
    }
    pendingExternalLoad.current = null;
    applyExternalPayload(raw, true);
  }, [applyExternalPayload]);

  const insertDesign = useCallback(
    (
      designSlug: string,
      elements: ExcalidrawElement[],
      files: BinaryFiles,
      bounds?: { width: number; height: number }
    ) => {
      const api = apiRef.current;
      if (!api) {
        return;
      }

      suppressChangeUntil.current = Date.now() + 1500;
      const { offsetX, offsetY } = designInsertOffset(
        elements,
        viewportCenter(latestAppState.current),
        bounds
      );
      const cloned = cloneDesignElements(elements, files, designSlug, offsetX, offsetY);
      const nextElements = [...api.getSceneElements(), ...cloned.elements];
      const nextFiles = { ...api.getFiles(), ...cloned.files };

      api.updateScene({
        elements: nextElements,
        files: nextFiles,
      });

      latestElements.current = nextElements;
      latestFiles.current = nextFiles;
      lastPersistedScene.current = sceneFingerprint(nextElements, nextFiles);
      sendDocumentChange(nextElements, latestAppState.current, nextFiles);
    },
    []
  );

  useEffect(() => {
    if (initial?.content) {
      const parsed = parsePayload(initial.content);
      latestElements.current = parsed.elements;
      latestFiles.current = parsed.files;
      lastPersistedScene.current = sceneFingerprint(parsed.elements, parsed.files);
      lastPersistedLiveCount.current = liveElementCount(parsed.elements);
    }

    const onMessage = (
      event: MessageEvent<{
        type?: string;
        content?: string;
        requestId?: number;
        designSlug?: string;
        elements?: ExcalidrawElement[];
        files?: BinaryFiles;
        bounds?: { width: number; height: number };
      }>
    ) => {
      const message = event.data;
      if (message?.type === "load" && typeof message.content === "string") {
        applyExternalPayload(message.content, message.external !== false);
        return;
      }

      const api = apiRef.current;
      if (message?.type === "getSelection" && typeof message.requestId === "number") {
        vscode.postMessage({
          type: "selectionInfo",
          requestId: message.requestId,
          elements: api ? collectSelection(api) : [],
        });
        return;
      }

      if (message?.type === "getSelectionElements" && typeof message.requestId === "number") {
        const selection = api ? collectSelectionElements(api) : { elements: [], files: {} };
        vscode.postMessage({
          type: "selectionElements",
          requestId: message.requestId,
          elements: selection.elements,
          files: selection.files,
        });
        return;
      }

      if (
        message?.type === "insertDesign" &&
        typeof message.designSlug === "string" &&
        Array.isArray(message.elements)
      ) {
        insertDesign(message.designSlug, message.elements, message.files ?? {}, message.bounds);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === "s" && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          event.stopImmediatePropagation();
          vscode.postMessage({ type: "save" });
          return;
        }

        if (event.key.toLowerCase() === "c" && !event.shiftKey && !event.altKey) {
          const api = apiRef.current;
          if (!api) {
            return;
          }

          const selection = collectSelection(api);
          if (selection.length === 0) {
            return;
          }

          event.preventDefault();
          event.stopImmediatePropagation();
          vscode.postMessage({ type: "copySelectionReference", silent: true });
        }
      }
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKeyDown, true);
    vscode.postMessage({ type: "ready" });

    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKeyDown, true);
      if (persistReadyTimer.current !== null) {
        window.clearTimeout(persistReadyTimer.current);
      }
    };
  }, [applyExternalPayload, insertDesign]);

  if (!payload) {
    return (
      <div
        style={{
          alignItems: "center",
          color: "#495057",
          display: "flex",
          fontFamily: "system-ui, sans-serif",
          fontSize: 14,
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        Loading diagram…
      </div>
    );
  }

  return (
    <div style={{ height: "100%", overflow: "hidden", width: "100%" }}>
      <Excalidraw
          viewModeEnabled={false}
          excalidrawAPI={(api) => {
            apiRef.current = api;
            suppressChangeUntil.current = Date.now() + 500;
            schedulePersistReady(api);
          }}
          initialData={excalidrawInitialData}
          onPointerDown={() => {
            isPointerDown.current = true;
          }}
          onPointerUp={() => {
            isPointerDown.current = false;
            window.requestAnimationFrame(() => {
              flushPendingExternalLoad();
            });
          }}
          onChange={(elements, appState, files) => {
            latestAppState.current = appState;
            latestElements.current = elements;
            latestFiles.current = files;
            if (!readyToPersist.current) {
              return;
            }
            if (Date.now() < suppressChangeUntil.current) {
              return;
            }

            const liveCount = liveElementCount(elements);
            if (liveCount === 0 && lastPersistedLiveCount.current > 0) {
              return;
            }

            const fingerprint = sceneFingerprint(elements, files);
            if (fingerprint === lastPersistedScene.current) {
              return;
            }
            lastPersistedScene.current = fingerprint;
            lastPersistedLiveCount.current = liveCount;

            sendDocumentChange(elements, appState, files);
          }}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
              export: {
                saveFileToDisk: false,
              },
            },
          }}
        />
    </div>
  );
}
