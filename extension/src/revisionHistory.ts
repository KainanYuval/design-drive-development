export type RevisionSource =
  | "initial"
  | "human"
  | "agent"
  | "conflict-resolution";

export type RevisionEntry = {
  hash: string;
  source: RevisionSource;
};

/**
 * Ordered revision checkpoints for host-level undo/redo.
 * Tracks synced diagram states (human saves and agent loads), not in-flight canvas edits.
 */
export class RevisionHistory {
  private stack: RevisionEntry[] = [];
  private index = -1;
  private redoStack: RevisionEntry[] = [];

  reset(entry: RevisionEntry): void {
    this.stack = [entry];
    this.index = 0;
    this.redoStack = [];
  }

  push(entry: RevisionEntry): void {
    const current = this.stack[this.index];
    if (current?.hash === entry.hash) {
      return;
    }

    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(entry);
    this.index = this.stack.length - 1;
    this.redoStack = [];
  }

  current(): RevisionEntry | undefined {
    return this.stack[this.index];
  }

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): RevisionEntry | undefined {
    if (!this.canUndo()) {
      return undefined;
    }

    const current = this.stack[this.index];
    if (current) {
      this.redoStack.push(current);
    }
    this.index -= 1;
    return this.stack[this.index];
  }

  redo(): RevisionEntry | undefined {
    const entry = this.redoStack.pop();
    if (!entry) {
      return undefined;
    }

    this.index += 1;
    this.stack[this.index] = entry;
    return entry;
  }

  restore(entries: RevisionEntry[], index: number): void {
    if (entries.length === 0) {
      return;
    }

    this.stack = [...entries];
    this.index = Math.min(Math.max(index, 0), entries.length - 1);
    this.redoStack = [];
  }

  snapshot(): { entries: RevisionEntry[]; index: number } {
    return { entries: [...this.stack], index: this.index };
  }
}
