import { createHash } from "node:crypto";
import { open, rename, stat, unlink, writeFile } from "node:fs/promises";
import { TextDecoder, TextEncoder } from "node:util";
import * as vscode from "vscode";

export function hashContent(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export type ConditionalSaveResult =
  | { saved: true; hash: string }
  | { saved: false; hash: string; content: Uint8Array };

export class ExcalidrawDocument implements vscode.CustomDocument {
  static async create(uri: vscode.Uri): Promise<ExcalidrawDocument> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new ExcalidrawDocument(uri, bytes);
  }

  private readonly decoder = new TextDecoder("utf-8");
  private readonly encoder = new TextEncoder();

  private content: Uint8Array;
  private contentHash: string;
  private readonly changeEmitter = new vscode.EventEmitter<void>();

  readonly onDidChange = this.changeEmitter.event;

  private constructor(
    readonly uri: vscode.Uri,
    initialContent: Uint8Array
  ) {
    this.content = initialContent;
    this.contentHash = hashContent(initialContent);
  }

  getContent(): Uint8Array {
    return this.content;
  }

  getText(): string {
    return this.decoder.decode(this.content);
  }

  getHash(): string {
    return this.contentHash;
  }

  updateFromBytes(nextContent: Uint8Array, emitChange = true): boolean {
    const nextHash = hashContent(nextContent);
    if (nextHash === this.contentHash) {
      return false;
    }

    this.content = nextContent;
    this.contentHash = nextHash;
    if (emitChange) {
      this.changeEmitter.fire();
    }
    return true;
  }

  updateFromText(text: string, emitChange = true): boolean {
    return this.updateFromBytes(this.encoder.encode(text), emitChange);
  }

  async save(): Promise<void> {
    await vscode.workspace.fs.writeFile(this.uri, this.content);
  }

  async saveIfDiskHash(
    expectedDiskHash: string,
    content: Uint8Array
  ): Promise<ConditionalSaveResult> {
    const lockPath = `${this.uri.fsPath}.ddd-write.lock`;
    const lock = await acquireWriteLock(lockPath);
    try {
      const current = await vscode.workspace.fs.readFile(this.uri);
      const currentHash = hashContent(current);
      if (currentHash !== expectedDiskHash) {
        return { saved: false, hash: currentHash, content: current };
      }

      const tempUri = this.uri.with({
        path: `${this.uri.path}.ddd-${process.pid}-${Date.now()}.tmp`,
      });
      await vscode.workspace.fs.writeFile(tempUri, content);
      try {
        // Cooperative agents honor the lock; recheck catches non-cooperative writes.
        const beforeRename = await vscode.workspace.fs.readFile(this.uri);
        const beforeRenameHash = hashContent(beforeRename);
        if (beforeRenameHash !== expectedDiskHash) {
          return {
            saved: false,
            hash: beforeRenameHash,
            content: beforeRename,
          };
        }
        if (this.uri.scheme === "file") {
          if (process.platform === "win32") {
            // Windows rename cannot replace an existing target.
            await writeFile(this.uri.fsPath, content);
          } else {
            // POSIX rename replaces the target atomically on the same filesystem.
            await rename(tempUri.fsPath, this.uri.fsPath);
          }
        } else {
          // Remote providers may reject overwrite-rename; writeFile preserves
          // the existing target if the provider fails.
          await vscode.workspace.fs.writeFile(this.uri, content);
        }
      } finally {
        try {
          await vscode.workspace.fs.delete(tempUri);
        } catch {
          // Rename already consumed the temporary file.
        }
      }
      return { saved: true, hash: hashContent(content) };
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }

  async saveAs(target: vscode.Uri): Promise<void> {
    await vscode.workspace.fs.writeFile(target, this.content);
  }

  async revert(): Promise<void> {
    const bytes = await vscode.workspace.fs.readFile(this.uri);
    this.updateFromBytes(bytes);
  }

  async backup(destination: vscode.Uri): Promise<vscode.CustomDocumentBackup> {
    await vscode.workspace.fs.writeFile(destination, this.content);
    return {
      id: destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(destination);
        } catch {
          // Ignore missing backup files.
        }
      },
    };
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}

async function acquireWriteLock(lockPath: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })
      );
      return handle;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > 30_000) {
          await unlink(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for diagram write lock: ${lockPath}`);
}
