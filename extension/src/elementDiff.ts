export type DiagramElement = {
  id: string;
  version?: number;
  versionNonce?: number;
  updated?: number;
  isDeleted?: boolean;
  [key: string]: unknown;
};

export type ElementDiff = {
  added: DiagramElement[];
  updated: DiagramElement[];
  removedIds: string[];
};

export type DiffStats = {
  changeCount: number;
  nextCount: number;
  prevCount: number;
};

const FULL_RELOAD_RATIO = 0.35;
const FULL_RELOAD_MIN_CHANGES = 250;
const FULL_RELOAD_RATIO_MIN_BASELINE = 20;

export function elementRevision(element: DiagramElement): string {
  return `${element.version ?? 0}:${element.versionNonce ?? 0}:${element.updated ?? 0}:${element.isDeleted === true}`;
}

export function diffElements(
  previous: readonly DiagramElement[],
  next: readonly DiagramElement[]
): ElementDiff {
  const prevById = new Map<string, DiagramElement>();
  for (const element of previous) {
    if (element.isDeleted) {
      continue;
    }
    prevById.set(element.id, element);
  }

  const nextById = new Map<string, DiagramElement>();
  for (const element of next) {
    if (element.isDeleted) {
      continue;
    }
    nextById.set(element.id, element);
  }

  const added: DiagramElement[] = [];
  const updated: DiagramElement[] = [];
  const removedIds: string[] = [];

  for (const [id, element] of nextById) {
    const prior = prevById.get(id);
    if (!prior) {
      added.push(element);
      continue;
    }
    if (elementRevision(prior) !== elementRevision(element)) {
      updated.push(element);
    }
  }

  for (const id of prevById.keys()) {
    if (!nextById.has(id)) {
      removedIds.push(id);
    }
  }

  return { added, updated, removedIds };
}

export function diffStats(diff: ElementDiff, nextCount: number): DiffStats {
  return {
    changeCount: diff.added.length + diff.updated.length + diff.removedIds.length,
    nextCount,
    prevCount: nextCount - diff.added.length + diff.removedIds.length,
  };
}

export function shouldUseFullReload(
  diff: ElementDiff,
  previousCount: number,
  nextCount: number,
  hasBaseline: boolean
): boolean {
  if (!hasBaseline) {
    return true;
  }

  const stats = diffStats(diff, nextCount);
  if (stats.changeCount === 0) {
    return false;
  }

  if (stats.changeCount >= FULL_RELOAD_MIN_CHANGES) {
    return true;
  }

  const baseline = Math.max(previousCount, nextCount, 1);
  if (baseline < FULL_RELOAD_RATIO_MIN_BASELINE) {
    return false;
  }
  return stats.changeCount / baseline >= FULL_RELOAD_RATIO;
}

export function parseDiagramElements(content: string): DiagramElement[] {
  try {
    const parsed = JSON.parse(content) as { elements?: unknown };
    if (!parsed || !Array.isArray(parsed.elements)) {
      return [];
    }
    return parsed.elements.filter(
      (element): element is DiagramElement =>
        typeof element === "object" &&
        element !== null &&
        typeof (element as DiagramElement).id === "string"
    );
  } catch {
    return [];
  }
}

export function parseDiagramFiles(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as { files?: unknown };
    if (parsed && typeof parsed.files === "object" && parsed.files !== null) {
      return parsed.files as Record<string, unknown>;
    }
  } catch {
    // ignore malformed payloads
  }
  return {};
}

export function snapshotElements(
  elements: readonly DiagramElement[]
): DiagramElement[] {
  return elements.filter((element) => element.isDeleted !== true);
}
