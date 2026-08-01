import type { ExcalidrawElement } from "@excalidraw/excalidraw/types";

export type OrbitConfig = {
  centerElementId: string;
  radius: number;
  periodSeconds: number;
  startAngleDeg?: number;
};

export function parseOrbitConfig(element: ExcalidrawElement): OrbitConfig | null {
  const customData = element.customData;
  if (!customData || typeof customData !== "object" || Array.isArray(customData)) {
    return null;
  }

  const orbit = (customData as { orbit?: unknown }).orbit;
  if (!orbit || typeof orbit !== "object" || Array.isArray(orbit)) {
    return null;
  }

  const record = orbit as Record<string, unknown>;
  if (typeof record.centerElementId !== "string" || !record.centerElementId.trim()) {
    return null;
  }
  if (typeof record.radius !== "number" || !Number.isFinite(record.radius) || record.radius <= 0) {
    return null;
  }
  if (
    typeof record.periodSeconds !== "number" ||
    !Number.isFinite(record.periodSeconds) ||
    record.periodSeconds <= 0
  ) {
    return null;
  }

  return {
    centerElementId: record.centerElementId,
    radius: record.radius,
    periodSeconds: record.periodSeconds,
    startAngleDeg:
      typeof record.startAngleDeg === "number" && Number.isFinite(record.startAngleDeg)
        ? record.startAngleDeg
        : 0,
  };
}

export function elementCenter(element: ExcalidrawElement): { cx: number; cy: number } {
  return {
    cx: element.x + element.width / 2,
    cy: element.y + element.height / 2,
  };
}

export function positionOnOrbit(
  element: ExcalidrawElement,
  center: { cx: number; cy: number },
  radius: number,
  angleRad: number
): ExcalidrawElement {
  const ecx = center.cx + radius * Math.cos(angleRad);
  const ecy = center.cy + radius * Math.sin(angleRad);
  return {
    ...element,
    x: ecx - element.width / 2,
    y: ecy - element.height / 2,
  };
}

export function collectOrbitJobs(elements: readonly ExcalidrawElement[]) {
  return elements.flatMap((element) => {
    const config = parseOrbitConfig(element);
    return config ? [{ elementId: element.id, config }] : [];
  });
}

export function applyOrbitFrame(
  elements: readonly ExcalidrawElement[],
  jobs: Array<{ elementId: string; config: OrbitConfig }>,
  elapsedSeconds: number
): ExcalidrawElement[] | null {
  if (jobs.length === 0) {
    return null;
  }

  const byId = new Map(elements.map((element) => [element.id, element]));
  let changed = false;

  const next = elements.map((element) => {
    const job = jobs.find((candidate) => candidate.elementId === element.id);
    if (!job) {
      return element;
    }

    const centerElement = byId.get(job.config.centerElementId);
    if (!centerElement) {
      return element;
    }

    const startAngle = ((job.config.startAngleDeg ?? 0) * Math.PI) / 180;
    const angle =
      startAngle + (elapsedSeconds / job.config.periodSeconds) * Math.PI * 2;
    const positioned = positionOnOrbit(
      element,
      elementCenter(centerElement),
      job.config.radius,
      angle
    );

    if (positioned.x !== element.x || positioned.y !== element.y) {
      changed = true;
    }
    return positioned;
  });

  return changed ? next : null;
}
