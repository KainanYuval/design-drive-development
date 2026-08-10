import * as fs from "node:fs";
import * as path from "node:path";
import type { RevisionEntry, RevisionSource } from "./revisionHistory";

export type PersistedRevisionIndex = {
  revisions: Array<RevisionEntry & { savedAt: string }>;
  index: number;
};

export function historyDirForDiagram(diagramPath: string): string {
  return `${diagramPath}.ddd-history`;
}

export function indexPathForDiagram(diagramPath: string): string {
  return path.join(historyDirForDiagram(diagramPath), "index.json");
}

export function snapshotPathForHash(diagramPath: string, hash: string): string {
  return path.join(historyDirForDiagram(diagramPath), `${hash}.excalidraw`);
}

export function loadPersistedIndex(
  diagramPath: string
): PersistedRevisionIndex | undefined {
  const indexPath = indexPathForDiagram(diagramPath);
  if (!fs.existsSync(indexPath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(
      fs.readFileSync(indexPath, "utf8")
    ) as PersistedRevisionIndex;
    if (
      !parsed ||
      !Array.isArray(parsed.revisions) ||
      typeof parsed.index !== "number"
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function loadPersistedSnapshot(
  diagramPath: string,
  hash: string
): string | undefined {
  const snapshotPath = snapshotPathForHash(diagramPath, hash);
  if (!fs.existsSync(snapshotPath)) {
    return undefined;
  }

  try {
    return fs.readFileSync(snapshotPath, "utf8");
  } catch {
    return undefined;
  }
}

export function persistRevisionSnapshot(
  diagramPath: string,
  hash: string,
  content: string,
  source: RevisionSource
): PersistedRevisionIndex {
  const dir = historyDirForDiagram(diagramPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(snapshotPathForHash(diagramPath, hash), content, "utf8");

  const existing = loadPersistedIndex(diagramPath);
  const revisions = existing?.revisions ?? [];
  const last = revisions[revisions.length - 1];
  let index = existing?.index ?? -1;

  if (!last || last.hash !== hash) {
    revisions.push({
      hash,
      source,
      savedAt: new Date().toISOString(),
    });
    index = revisions.length - 1;
  } else {
    index = revisions.length - 1;
  }

  const next: PersistedRevisionIndex = { revisions, index };
  fs.writeFileSync(indexPathForDiagram(diagramPath), JSON.stringify(next, null, 2));
  return next;
}

export function persistRevisionIndex(
  diagramPath: string,
  revisions: RevisionEntry[],
  index: number
): void {
  const dir = historyDirForDiagram(diagramPath);
  fs.mkdirSync(dir, { recursive: true });
  const payload: PersistedRevisionIndex = {
    revisions: revisions.map((entry) => ({
      ...entry,
      savedAt: new Date().toISOString(),
    })),
    index,
  };
  fs.writeFileSync(indexPathForDiagram(diagramPath), JSON.stringify(payload, null, 2));
}

export function hydrateRevisionEntries(
  diagramPath: string,
  persisted: PersistedRevisionIndex
): { entries: RevisionEntry[]; snapshots: Map<string, string> } {
  const snapshots = new Map<string, string>();
  const entries: RevisionEntry[] = [];

  for (const revision of persisted.revisions) {
    const content = loadPersistedSnapshot(diagramPath, revision.hash);
    if (!content) {
      continue;
    }
    entries.push({ hash: revision.hash, source: revision.source });
    snapshots.set(revision.hash, content);
  }

  return { entries, snapshots };
}
