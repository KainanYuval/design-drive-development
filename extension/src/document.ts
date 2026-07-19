import { createHash } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";
import * as vscode from "vscode";

export function hashContent(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

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
