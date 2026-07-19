import type { BinaryFiles, ExcalidrawElement } from "@excalidraw/excalidraw/types";

function randomId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function remapId(idMap: Map<string, string>, id: string | null | undefined): string | null {
  if (!id) {
    return null;
  }
  return idMap.get(id) ?? id;
}

export function cloneDesignElements(
  elements: ExcalidrawElement[],
  files: BinaryFiles,
  designSlug: string,
  offsetX: number,
  offsetY: number
): { elements: ExcalidrawElement[]; files: BinaryFiles } {
  const idMap = new Map<string, string>();
  for (const element of elements) {
    idMap.set(element.id, randomId());
  }

  const groupId = `design:${designSlug}`;
  const cloned = elements.map((element) => {
    const next = {
      ...element,
      id: idMap.get(element.id)!,
      x: element.x + offsetX,
      y: element.y + offsetY,
      groupIds: [...(element.groupIds ?? []), groupId],
      version: 1,
      versionNonce: Math.floor(Math.random() * 1_000_000_000),
      updated: Date.now(),
    } as ExcalidrawElement;

    if ("containerId" in next && next.containerId) {
      next.containerId = remapId(idMap, next.containerId);
    }

    if (next.boundElements) {
      next.boundElements = next.boundElements.map((bound) => ({
        ...bound,
        id: remapId(idMap, bound.id) ?? bound.id,
      }));
    }

    if (next.type === "arrow") {
      if (next.startBinding?.elementId) {
        next.startBinding = {
          ...next.startBinding,
          elementId: remapId(idMap, next.startBinding.elementId) ?? next.startBinding.elementId,
        };
      }
      if (next.endBinding?.elementId) {
        next.endBinding = {
          ...next.endBinding,
          elementId: remapId(idMap, next.endBinding.elementId) ?? next.endBinding.elementId,
        };
      }
    }

    return next;
  });

  return { elements: cloned, files: { ...files } };
}

export function designInsertOffset(
  elements: ExcalidrawElement[],
  viewport: { centerX: number; centerY: number },
  bounds?: { width: number; height: number }
): { offsetX: number; offsetY: number } {
  const width = bounds?.width;
  const height = bounds?.height;

  if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
    return {
      offsetX: viewport.centerX - width / 2,
      offsetY: viewport.centerY - height / 2,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const element of elements) {
    const elementWidth = "width" in element && typeof element.width === "number" ? element.width : 0;
    const elementHeight =
      "height" in element && typeof element.height === "number" ? element.height : 0;
    minX = Math.min(minX, element.x);
    minY = Math.min(minY, element.y);
    maxX = Math.max(maxX, element.x + elementWidth);
    maxY = Math.max(maxY, element.y + elementHeight);
  }

  if (!Number.isFinite(minX)) {
    return { offsetX: viewport.centerX, offsetY: viewport.centerY };
  }

  return {
    offsetX: viewport.centerX - (minX + maxX) / 2,
    offsetY: viewport.centerY - (minY + maxY) / 2,
  };
}
