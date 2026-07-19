import * as vscode from "vscode";
import { ExcalidrawEditorProvider } from "./editorProvider";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(ExcalidrawEditorProvider.register(context));
}

export function deactivate(): void {}
