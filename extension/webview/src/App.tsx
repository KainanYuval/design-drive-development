import { CaptureUpdateAction, Excalidraw } from "@excalidraw/excalidraw";
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

type IncomingLoad = {
  content: string;
  external: boolean;
  generation: number;
  hash: string;
  agentTurn?: boolean;
};

const PERSIST_READY_MS = 100;
const AGENT_TURN_PERSIST_READY_MS = 16;

function parsePayload(raw: string): ExcalidrawPayload {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { elements: [], appState: {}, files: {} };
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      type?: unknown;
      elements?: ExcalidrawElement[];
      appState?: Partial<AppState>;
      files?: BinaryFiles;
    } | null;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      parsed.type !== "excalidraw" ||
      !Array.isArray(parsed.elements)
    ) {
      return { elements: [], appState: {}, files: {} };
    }

    return {
      elements: parsed.elements ?? [],
      appState: parsed.appState ?? {},
      files: parsed.files ?? {},
    };
  } catch {
    return { elements: [], appState: {}, files: {} };
  }
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

export function App(): JSX.Element {
  const initial = window.__DDD_INITIAL_DIAGRAM__;
  const [payload, setPayload] = useState<ExcalidrawPayload | null>(() => {
    if (!initial?.content) {
      return null;
    }
    return parsePayload(initial.content);
  });
  const [agentTurnActive, setAgentTurnActive] = useState(false);
  const [agentTurnLabel, setAgentTurnLabel] = useState("Agent turn");
  const agentTurnActiveRef = useRef(false);
  const suppressChangeUntil = useRef(0);
  const latestAppState = useRef<Partial<AppState>>({});
  const latestElements = useRef<ExcalidrawElement[]>([]);
  const latestFiles = useRef<BinaryFiles>({});
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const lastPersistedScene = useRef("");
  const diagramReadySent = useRef(false);
  const isPointerDown = useRef(false);
  const pendingExternalLoad = useRef<IncomingLoad | null>(null);
  const pendingLoadAck = useRef<{ generation: number; hash: string } | null>(null);
  const currentGeneration = useRef(0);
  const readyToPersist = useRef(false);
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
    const delay = agentTurnActiveRef.current
      ? AGENT_TURN_PERSIST_READY_MS
      : PERSIST_READY_MS;
    persistReadyTimer.current = window.setTimeout(() => {
      const elements = api.getSceneElements();
      const files = api.getFiles();
      lastPersistedScene.current = sceneFingerprint(elements, files);
      latestElements.current = [...elements];
      latestFiles.current = { ...files };
      readyToPersist.current = true;
      persistReadyTimer.current = null;
      const ack = pendingLoadAck.current;
      if (ack && ack.generation >= currentGeneration.current) {
        pendingLoadAck.current = null;
        currentGeneration.current = ack.generation;
        vscode.postMessage({
          type: "loadApplied",
          generation: ack.generation,
          appliedHash: ack.hash,
        });
      }
    }, delay);
  }, []);

  useEffect(() => {
    if (!payload || diagramReadySent.current || !window.__DDD_APPLET__) {
      return;
    }
    diagramReadySent.current = true;
    vscode.postMessage({ type: "timing", phase: "diagram-render" });
  }, [payload]);

  const applyExternalPayload = useCallback((load: IncomingLoad): boolean => {
    if (load.generation < currentGeneration.current) {
      return false;
    }
    const parsed = parsePayload(load.content);
    const nextFingerprint = sceneFingerprint(parsed.elements, parsed.files);

    if (load.external) {
      if (isPointerDown.current && !agentTurnActiveRef.current) {
        pendingExternalLoad.current = load;
        return false;
      }
    }

    if (load.agentTurn !== undefined) {
      agentTurnActiveRef.current = load.agentTurn;
      setAgentTurnActive(load.agentTurn);
    }

    if (load.external) {
      suppressChangeUntil.current = agentTurnActiveRef.current
        ? Date.now() + 80
        : Date.now() + 400;
    } else {
      suppressChangeUntil.current = Date.now() + 500;
    }

    latestElements.current = parsed.elements;
    latestFiles.current = parsed.files;
    lastPersistedScene.current = nextFingerprint;
    pendingLoadAck.current = {
      generation: load.generation,
      hash: load.hash,
    };

    const api = apiRef.current;
    if (api) {
      readyToPersist.current = false;
      api.updateScene({
        elements: parsed.elements,
        files: parsed.files,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      schedulePersistReady(api);
      return true;
    }

    readyToPersist.current = false;
    setPayload({
      elements: parsed.elements,
      appState: preserveViewState(parsed.appState, latestAppState.current),
      files: parsed.files,
    });
    return true;
  }, [schedulePersistReady]);

  const flushPendingExternalLoad = useCallback(() => {
    const load = pendingExternalLoad.current;
    if (!load) {
      return;
    }
    pendingExternalLoad.current = null;
    applyExternalPayload(load);
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
      sendDocumentChange(
        nextElements,
        latestAppState.current,
        nextFiles,
        currentGeneration.current
      );
    },
    []
  );

  useEffect(() => {
    if (initial?.content) {
      const parsed = parsePayload(initial.content);
      latestElements.current = parsed.elements;
      latestFiles.current = parsed.files;
      lastPersistedScene.current = sceneFingerprint(parsed.elements, parsed.files);
    }

    const onMessage = (
      event: MessageEvent<{
        type?: string;
        content?: string;
        external?: boolean;
        generation?: number;
        hash?: string;
        requestId?: number;
        designSlug?: string;
        elements?: ExcalidrawElement[];
        files?: BinaryFiles;
        bounds?: { width: number; height: number };
        active?: boolean;
        label?: string;
      }>
    ) => {
      const message = event.data;
      if (message?.type === "agentTurn") {
        const active = message.active === true;
        agentTurnActiveRef.current = active;
        setAgentTurnActive(active);
        if (typeof message.label === "string" && message.label.trim()) {
          setAgentTurnLabel(message.label.trim());
        } else if (!active) {
          setAgentTurnLabel("Agent turn");
        }
        return;
      }

      if (
        message?.type === "cancelLoad" &&
        typeof message.generation === "number"
      ) {
        if (
          pendingExternalLoad.current?.generation === message.generation
        ) {
          pendingExternalLoad.current = null;
        }
        if (pendingLoadAck.current?.generation === message.generation) {
          pendingLoadAck.current = null;
        }
        return;
      }

      if (
        message?.type === "adoptGeneration" &&
        typeof message.generation === "number"
      ) {
        currentGeneration.current = Math.max(
          currentGeneration.current,
          message.generation
        );
        return;
      }

      if (
        message?.type === "load" &&
        typeof message.content === "string" &&
        typeof message.generation === "number" &&
        typeof message.hash === "string"
      ) {
        applyExternalPayload({
          content: message.content,
          external: message.external !== false,
          generation: message.generation,
          hash: message.hash,
          agentTurn: message.agentTurn === true,
        });
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
    <div style={{ height: "100%", overflow: "hidden", position: "relative", width: "100%" }}>
      {agentTurnActive ? (
        <div
          aria-live="assertive"
          role="status"
          style={{
            alignItems: "center",
            background: "rgba(255, 245, 245, 0.96)",
            borderBottom: "1px solid #ffc9c9",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            color: "#c92a2a",
            display: "flex",
            fontFamily: "system-ui, sans-serif",
            fontSize: 13,
            fontWeight: 600,
            gap: 10,
            left: 0,
            letterSpacing: "0.01em",
            padding: "10px 14px",
            position: "absolute",
            right: 0,
            top: 0,
            zIndex: 20,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              animation: "ddd-agent-pulse 1s ease-in-out infinite",
              background: "#fa5252",
              borderRadius: "999px",
              boxShadow: "0 0 0 0 rgba(250, 82, 82, 0.55)",
              display: "inline-block",
              flexShrink: 0,
              height: 12,
              width: 12,
            }}
          />
          <span>{agentTurnLabel} — AI is editing. Canvas input paused.</span>
        </div>
      ) : null}
      <style>{`
        @keyframes ddd-agent-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(250, 82, 82, 0.55); }
          50% { box-shadow: 0 0 0 8px rgba(250, 82, 82, 0); }
        }
      `}</style>
      <div
        style={{
          height: "100%",
          paddingTop: agentTurnActive ? 42 : 0,
          width: "100%",
        }}
      >
      <Excalidraw
          viewModeEnabled={agentTurnActive}
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
            if (agentTurnActiveRef.current) {
              return;
            }
            if (!readyToPersist.current) {
              return;
            }
            if (Date.now() < suppressChangeUntil.current) {
              return;
            }

            const fingerprint = sceneFingerprint(elements, files);
            if (fingerprint === lastPersistedScene.current) {
              return;
            }
            lastPersistedScene.current = fingerprint;

            sendDocumentChange(
              elements,
              appState,
              files,
              currentGeneration.current
            );
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
    </div>
  );
}
