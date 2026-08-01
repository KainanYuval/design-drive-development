import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { hashContent } from "./document";
import { ExcalidrawDocument } from "./document";
import { buildSelectionReference, SelectedElementInfo } from "./selectionReference";
import {
  confirmDesignOverwrite,
  designGroupUriForName,
  designReferencePath,
  getDesignElements,
  getDesignFiles,
  listSavedDesigns,
  loadDesignGroup,
  loadExistingDesignGroup,
  saveDesignGroup,
} from "./designLibrary";
import { ensureDesignsFolderConsent } from "./designsConsent";
import { DiagramLintReporter } from "./diagramLintReport";
import {
  classifyDiagramText,
  normalizeDiagramText,
} from "./diagramDefaults";
import {
  AGENT_TURN_WATCH_DEBOUNCE_MS,
  agentTurnLockPath,
  readAgentTurnLockSync,
  WATCH_DEBOUNCE_MS,
} from "./agentTurn";
import { SyncCoordinator, SyncEffect } from "./syncCoordinator";

const OUTPUT_CHANNEL = "Design Drive Development (DDD)";
const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL);
const AUTO_SAVE_DELAY_MS = 300;
const LINT_DELAY_MS = 600;

let lintReporter: DiagramLintReporter;

const WEBVIEW_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data: blob: vscode-resource: https:; style-src 'unsafe-inline' vscode-resource:; script-src 'nonce-__NONCE__' vscode-resource:; font-src vscode-resource: data:;"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Excalidraw</title>
    <link rel="stylesheet" href="__STYLE_URI__" />
    <style>
      html,
      body,
      #root {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="__NONCE__" src="__SCRIPT_URI__"></script>
  </body>
</html>`;

export class ExcalidrawEditorProvider implements vscode.CustomEditorProvider<ExcalidrawDocument> {
  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    lintReporter = new DiagramLintReporter(outputChannel);
    const provider = new ExcalidrawEditorProvider(context);
    const editorRegistration = vscode.window.registerCustomEditorProvider(
      ExcalidrawEditorProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    );

    const reopenCommand = vscode.commands.registerCommand(
      "design-drive-development.openWith",
      async (uri?: vscode.Uri) => {
        let target = uri;
        if (!target && vscode.window.activeTextEditor) {
          target = vscode.window.activeTextEditor.document.uri;
        }

        if (!target) {
          const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
          if (activeTab?.input instanceof vscode.TabInputCustom) {
            target = activeTab.input.uri;
          }
        }

        if (!target) {
          void vscode.window.showWarningMessage(
            "Open an `.excalidraw` file first, then run this command."
          );
          return;
        }

        await vscode.commands.executeCommand(
          "vscode.openWith",
          target,
          ExcalidrawEditorProvider.viewType
        );
      }
    );

    const copySelectionCommand = vscode.commands.registerCommand(
      "design-drive-development.copySelectionReference",
      async () => {
        const editor = provider.getActiveEditor();
        if (!editor) {
          void vscode.window.showWarningMessage(
            "Open a diagram in Design Drive Development first."
          );
          return;
        }

        await editor.copySelectionReference();
      }
    );

    const saveDesignCommand = vscode.commands.registerCommand(
      "design-drive-development.saveSelectionAsDesign",
      async () => {
        const editor = provider.getActiveEditor();
        if (!editor) {
          void vscode.window.showWarningMessage(
            "Open a diagram in Design Drive Development first."
          );
          return;
        }

        await editor.saveSelectionAsDesign();
      }
    );

    const insertDesignCommand = vscode.commands.registerCommand(
      "design-drive-development.insertDesign",
      async () => {
        const editor = provider.getActiveEditor();
        if (!editor) {
          void vscode.window.showWarningMessage(
            "Open a diagram in Design Drive Development first."
          );
          return;
        }

        await editor.insertDesignFromRepo();
      }
    );

    return vscode.Disposable.from(
      editorRegistration,
      reopenCommand,
      copySelectionCommand,
      saveDesignCommand,
      insertDesignCommand,
      { dispose: () => lintReporter.dispose() }
    );
  }

  static readonly viewType = "design-drive-development.editor";

  private readonly openEditors = new Map<string, ExcalidrawEditor>();
  private readonly onDidChangeEmitter =
    new vscode.EventEmitter<vscode.CustomDocumentEditEvent<ExcalidrawDocument>>();

  readonly onDidChangeCustomDocument = this.onDidChangeEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  getActiveEditor(): ExcalidrawEditor | undefined {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (!(activeTab?.input instanceof vscode.TabInputCustom)) {
      return undefined;
    }

    if (activeTab.input.viewType !== ExcalidrawEditorProvider.viewType) {
      return undefined;
    }

    return this.openEditors.get(activeTab.input.uri.toString());
  }

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<ExcalidrawDocument> {
    return ExcalidrawDocument.create(uri);
  }

  async resolveCustomEditor(
    document: ExcalidrawDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    try {
      const editor = new ExcalidrawEditor(this.context, document, webviewPanel);
      this.openEditors.set(document.uri.toString(), editor);

      webviewPanel.onDidDispose(() => {
        this.openEditors.delete(document.uri.toString());
        editor.dispose();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(`Failed to open editor: ${message}`);
      void vscode.window.showErrorMessage(`Excalidraw editor failed to open: ${message}`);
      throw error;
    }
  }

  async saveCustomDocument(document: ExcalidrawDocument): Promise<void> {
    const editor = this.openEditors.get(document.uri.toString());
    if (editor) {
      await editor.persistToDisk();
      return;
    }

    await document.save();
  }

  async saveCustomDocumentAs(
    document: ExcalidrawDocument,
    destination: vscode.Uri
  ): Promise<void> {
    await document.saveAs(destination);
  }

  async revertCustomDocument(document: ExcalidrawDocument): Promise<void> {
    await document.revert();
    this.openEditors.get(document.uri.toString())?.pushLatestFromDisk("revert");
  }

  async backupCustomDocument(
    document: ExcalidrawDocument,
    context: vscode.CustomDocumentBackupContext
  ): Promise<vscode.CustomDocumentBackup> {
    return document.backup(context.destination);
  }
}

class ExcalidrawEditor implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private saveTimer: NodeJS.Timeout | undefined;
  private lintTimer: NodeJS.Timeout | undefined;
  private webviewReady = false;
  private acceptWebviewEdits = false;
  private agentTurnActive = false;
  private diskWatchDelayMs = WATCH_DEBOUNCE_MS;
  private diskWatchSchedulePush: (() => void) | undefined;
  private readonly sync: SyncCoordinator;
  private readonly contentByHash = new Map<string, string>();
  private readonly pendingLoadContent = new Map<number, string>();
  private conflictNotificationOpen = false;
  private invalidDiskWarningHash = "";
  private selectionRequestId = 0;
  private pendingSelectionRequests = new Map<
    number,
    {
      resolve: (selection: SelectedElementInfo[]) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private pendingSelectionElementsRequests = new Map<
    number,
    {
      resolve: (payload: { elements: unknown[]; files: Record<string, unknown> }) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly document: ExcalidrawDocument,
    private readonly panel: vscode.WebviewPanel
  ) {
    this.sync = new SyncCoordinator(this.document.getHash());
    this.contentByHash.set(this.document.getHash(), this.document.getText());
    outputChannel.appendLine(`Opened ${this.document.uri.fsPath}`);

    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
        vscode.Uri.joinPath(this.context.extensionUri, "webview"),
      ],
    };

    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.watchExternalChanges();
    this.scheduleLint();

    this.disposables.push(
      this.panel.onDidChangeViewState((event) => {
        if (!event.webviewPanel.visible && this.isHumanDirty()) {
          void this.persistToDisk();
        }
      }),
      this.panel.webview.onDidReceiveMessage(async (message) => {
        if (message?.type === "ready") {
          this.webviewReady = true;
          void this.handleWebviewReady();
          return;
        }

        if (message?.type === "pull") {
          this.pushLatestFromDisk("pull");
          return;
        }

        if (
          message?.type === "loadApplied" &&
          typeof message.generation === "number" &&
          typeof message.appliedHash === "string"
        ) {
          this.applyWebviewLoad(message.generation, message.appliedHash);
          return;
        }

        if (message?.type === "change" && typeof message.content === "string") {
          await this.handleWebviewChange(
            message.content,
            typeof message.basedOnGeneration === "number"
              ? message.basedOnGeneration
              : -1
          );
          return;
        }

        if (message?.type === "save") {
          await this.flushSave(true);
          return;
        }

        if (message?.type === "selectionInfo" && typeof message.requestId === "number") {
          this.resolveSelectionRequest(message.requestId, message.elements);
          return;
        }

        if (message?.type === "selectionElements" && typeof message.requestId === "number") {
          this.resolveSelectionElementsRequest(
            message.requestId,
            message.elements,
            message.files
          );
          return;
        }

        if (message?.type === "copySelectionReference") {
          await this.copySelectionReference(message.silent === true);
        }
      })
    );
  }

  async saveSelectionAsDesign(): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(this.document.uri);
    if (!folder) {
      void vscode.window.showWarningMessage("Save this diagram inside a workspace folder first.");
      return;
    }

    try {
      const { elements, files } = await this.requestSelectionElements();
      if (elements.length === 0) {
        void vscode.window.showWarningMessage("Select one or more diagram elements first.");
        return;
      }

      const allowed = await ensureDesignsFolderConsent(this.context, folder);
      if (!allowed) {
        return;
      }

      const name = await vscode.window.showInputBox({
        title: "Save Selection as Design",
        prompt: "Name for this reusable design group",
        placeHolder: "Auth Stack",
        validateInput: (value) =>
          value.trim().length > 0 ? undefined : "Name is required.",
      });
      if (!name) {
        return;
      }

      const description = await vscode.window.showInputBox({
        title: "Save Selection as Design",
        prompt: "Optional description",
        placeHolder: "Gateway, auth service, and database",
      });

      const targetUri = designGroupUriForName(folder, name);
      const existing = await loadExistingDesignGroup(targetUri);
      if (existing) {
        const overwrite = await confirmDesignOverwrite(name, existing);
        if (!overwrite) {
          return;
        }
      }

      const uri = await saveDesignGroup(
        folder,
        name,
        description,
        elements,
        files
      );

      const reference = `@${designReferencePath(uri)}`;
      void vscode.window.showInformationMessage(`Saved design "${name.trim()}" → ${reference}`);
      outputChannel.appendLine(`[design] saved ${reference}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Could not save design: ${message}`);
    }
  }

  async insertDesignFromRepo(): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(this.document.uri);
    if (!folder) {
      void vscode.window.showWarningMessage("Open this diagram inside a workspace folder first.");
      return;
    }

    const designs = await listSavedDesigns(folder);
    if (designs.length === 0) {
      void vscode.window.showInformationMessage(
        "No saved designs yet. Select elements and run Save Selection as Design."
      );
      return;
    }

    const picked = await vscode.window.showQuickPick(
      designs.map((design) => ({
        label: design.name,
        description: design.description ?? design.fileName,
        design,
      })),
      {
        title: "Insert Design from Repository",
        placeHolder: "Choose a saved design group",
      }
    );

    if (!picked) {
      return;
    }

    try {
      const saved = await loadDesignGroup(picked.design.uri);
      const slug = picked.design.fileName.replace(/\.excalidraw-group\.json$/, "");

      void this.panel.webview.postMessage({
        type: "insertDesign",
        designSlug: slug,
        elements: getDesignElements(saved),
        files: getDesignFiles(saved),
        bounds: saved.bounds,
      });

      void vscode.window.showInformationMessage(`Inserted design "${saved.name}".`);
      outputChannel.appendLine(`[design] inserted ${saved.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Could not insert design: ${message}`);
    }
  }

  async copySelectionReference(silent = false): Promise<void> {
    try {
      const selection = await this.requestSelection();
      if (selection.length === 0) {
        if (!silent) {
          void vscode.window.showWarningMessage("Select one or more diagram elements first.");
        }
        return;
      }

      const reference = buildSelectionReference(
        this.document.uri,
        this.document.getText(),
        selection
      );
      await vscode.env.clipboard.writeText(reference);
      if (!silent) {
        void vscode.window.showInformationMessage(`Copied: ${reference}`);
      }
      outputChannel.appendLine(`[copy] ${reference}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!silent) {
        void vscode.window.showErrorMessage(`Could not copy selection reference: ${message}`);
      }
    }
  }

  private requestSelection(): Promise<SelectedElementInfo[]> {
    if (!this.webviewReady) {
      return Promise.reject(new Error("Diagram is still loading."));
    }

    return new Promise((resolve, reject) => {
      const requestId = ++this.selectionRequestId;
      const timer = setTimeout(() => {
        this.pendingSelectionRequests.delete(requestId);
        reject(new Error("Timed out waiting for diagram selection."));
      }, 3000);

      this.pendingSelectionRequests.set(requestId, { resolve, reject, timer });
      void this.panel.webview.postMessage({ type: "getSelection", requestId });
    });
  }

  private resolveSelectionRequest(requestId: number, elements: unknown): void {
    const pending = this.pendingSelectionRequests.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingSelectionRequests.delete(requestId);

    if (!Array.isArray(elements)) {
      pending.reject(new Error("Diagram did not return a valid selection."));
      return;
    }

    const selection = elements
      .filter((item): item is SelectedElementInfo => {
        return (
          typeof item === "object" &&
          item !== null &&
          typeof (item as SelectedElementInfo).id === "string" &&
          typeof (item as SelectedElementInfo).type === "string"
        );
      })
      .map((item) => ({
        id: item.id,
        type: item.type,
        label: item.label,
      }));

    pending.resolve(selection);
  }

  private requestSelectionElements(): Promise<{
    elements: unknown[];
    files: Record<string, unknown>;
  }> {
    if (!this.webviewReady) {
      return Promise.reject(new Error("Diagram is still loading."));
    }

    return new Promise((resolve, reject) => {
      const requestId = ++this.selectionRequestId;
      const timer = setTimeout(() => {
        this.pendingSelectionElementsRequests.delete(requestId);
        reject(new Error("Timed out waiting for diagram selection."));
      }, 3000);

      this.pendingSelectionElementsRequests.set(requestId, { resolve, reject, timer });
      void this.panel.webview.postMessage({ type: "getSelectionElements", requestId });
    });
  }

  private resolveSelectionElementsRequest(
    requestId: number,
    elements: unknown,
    files: unknown
  ): void {
    const pending = this.pendingSelectionElementsRequests.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingSelectionElementsRequests.delete(requestId);

    if (!Array.isArray(elements)) {
      pending.reject(new Error("Diagram did not return selected elements."));
      return;
    }

    pending.resolve({
      elements,
      files:
        typeof files === "object" && files !== null
          ? (files as Record<string, unknown>)
          : {},
    });
  }

  private async handleWebviewReady(): Promise<void> {
    await this.seedEmptyDiagramIfNeeded();
    this.pushLatestFromDisk("ready", true);
  }

  private async seedEmptyDiagramIfNeeded(): Promise<void> {
    const bytes = this.readDiskBytes();
    if (!bytes) {
      return;
    }

    const rawText = new TextDecoder().decode(bytes);
    const classification = classifyDiagramText(rawText);
    if (classification === "valid") {
      return;
    }
    if (classification === "invalid") {
      outputChannel.appendLine(
        "[ready] diagram JSON invalid — keeping disk unchanged"
      );
      void vscode.window.showErrorMessage(
        `${path.basename(this.document.uri.fsPath)} contains invalid Excalidraw JSON. Fix the JSON and save again.`
      );
      return;
    }

    const normalized = normalizeDiagramText(rawText);
    this.document.updateFromText(normalized, false);
    try {
      await this.document.save();
      outputChannel.appendLine("[ready] seeded empty diagram on disk");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(`[ready] failed to seed diagram: ${message}`);
    }
  }

  async pushLatestFromDisk(reason: string, force = false): Promise<void> {
    if (!this.webviewReady) {
      return;
    }

    const bytes = this.readDiskBytes();
    if (!bytes) {
      outputChannel.appendLine(`[${reason}] disk read failed`);
      return;
    }

    const diskText = new TextDecoder().decode(bytes);
    if (classifyDiagramText(diskText) !== "valid") {
      const invalidHash = hashContent(bytes);
      if (invalidHash !== this.invalidDiskWarningHash) {
        this.invalidDiskWarningHash = invalidHash;
        outputChannel.appendLine(
          `[${reason}] ignored invalid diagram JSON; waiting for a valid save`
        );
        void vscode.window.setStatusBarMessage(
          "Diagram JSON invalid — canvas kept at last valid revision",
          3000
        );
      }
      return;
    }
    this.invalidDiskWarningHash = "";
    const diskHash = hashContent(new TextEncoder().encode(diskText));
    this.contentByHash.set(diskHash, diskText);
    const effects =
      reason === "ready"
        ? this.sync.bootstrap(diskHash)
        : force
          ? this.sync.acceptExternal(diskHash)
          : this.sync.diskObserved(diskHash);
    await this.executeSyncEffects(effects, reason);
  }

  private applyWebviewLoad(generation: number, appliedHash: string): void {
    if (!this.sync.loadApplied(generation, appliedHash)) {
      outputChannel.appendLine(
        `[loadApplied] ignored stale generation ${generation}`
      );
      return;
    }
    const content =
      this.pendingLoadContent.get(generation) ??
      this.contentByHash.get(appliedHash);
    if (content) {
      this.document.updateFromText(content, false);
    }
    for (const pendingGeneration of this.pendingLoadContent.keys()) {
      if (pendingGeneration <= generation) {
        this.pendingLoadContent.delete(pendingGeneration);
      }
    }
    outputChannel.appendLine(
      `[loadApplied] generation ${generation} (${appliedHash.slice(0, 8)})`
    );
    this.acceptWebviewEdits = !this.agentTurnActive;
    this.scheduleLint();
  }

  private setupDiskWatchDebounce(delayMs: number): void {
    this.diskWatchDelayMs = delayMs;
    this.diskWatchSchedulePush = debounce(() => {
      void this.pushLatestFromDisk("watch");
    }, delayMs);
  }

  private async refreshAgentTurnState(reason: string): Promise<void> {
    if (this.document.uri.scheme !== "file" || !this.document.uri.fsPath) {
      return;
    }

    const lock = readAgentTurnLockSync(this.document.uri.fsPath);

    if (lock && !this.agentTurnActive) {
      this.enterAgentTurn(lock.label ?? "Agent turn", reason);
      return;
    }

    if (!lock && this.agentTurnActive) {
      await this.exitAgentTurn(reason);
      return;
    }

    if (lock && this.agentTurnActive) {
      void this.panel.webview.postMessage({
        type: "agentTurn",
        active: true,
        label: lock.label ?? "Agent turn",
      });
    }
  }

  private enterAgentTurn(label: string, reason: string): void {
    this.agentTurnActive = true;
    this.sync.beginAgentTurn();
    this.cancelPendingSave();
    this.acceptWebviewEdits = false;
    this.setupDiskWatchDebounce(AGENT_TURN_WATCH_DEBOUNCE_MS);
    void this.panel.webview.postMessage({
      type: "agentTurn",
      active: true,
      label,
    });
    outputChannel.appendLine(`[agent-turn] started (${reason})`);
    void this.pushLatestFromDisk(`${reason}-agent-turn-start`, true);
  }

  private async exitAgentTurn(reason: string): Promise<void> {
    this.agentTurnActive = false;
    this.sync.endAgentTurn();
    this.setupDiskWatchDebounce(WATCH_DEBOUNCE_MS);
    void this.panel.webview.postMessage({
      type: "agentTurn",
      active: false,
    });
    outputChannel.appendLine(`[agent-turn] ended (${reason})`);
    await this.pushLatestFromDisk(`${reason}-agent-turn-end`, true);
  }

  private scheduleLint(): void {
    if (this.lintTimer) {
      clearTimeout(this.lintTimer);
    }
    this.lintTimer = setTimeout(() => {
      void lintReporter.publish(this.document.uri, this.document.getText());
    }, LINT_DELAY_MS);
  }

  private async handleWebviewChange(
    content: string,
    basedOnGeneration: number
  ): Promise<void> {
    if (!this.acceptWebviewEdits || this.agentTurnActive) {
      return;
    }
    const before = this.sync.snapshot();
    if (basedOnGeneration !== before.generation) {
      if (
        before.phase === "applyingAgent" &&
        basedOnGeneration < before.generation &&
        before.awaitingHash
      ) {
        if (this.document.updateFromText(content, false)) {
          void this.panel.webview.postMessage({
            type: "cancelLoad",
            generation: before.generation,
          });
          void this.panel.webview.postMessage({
            type: "adoptGeneration",
            generation: before.generation,
          });
          const humanHash = this.document.getHash();
          this.contentByHash.set(humanHash, content);
          this.sync.canvasChanged(humanHash);
          await this.executeSyncEffects(
            this.sync.diskObserved(before.awaitingHash),
            "interaction-conflict"
          );
          this.scheduleLint();
        }
        return;
      }
      outputChannel.appendLine(
        `[change] ignored stale generation ${basedOnGeneration}`
      );
      return;
    }

    const changed = this.document.updateFromText(content, false);
    if (!changed) {
      return;
    }

    const hash = this.document.getHash();
    this.contentByHash.set(hash, content);
    this.sync.canvasChanged(hash);
    this.scheduleAutoSave();
    this.scheduleLint();
  }

  private scheduleAutoSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      void this.persistToDisk();
    }, AUTO_SAVE_DELAY_MS);
  }

  async persistToDisk(): Promise<void> {
    this.cancelPendingSave();
    const [effect] = this.sync.requestHumanSave();
    if (!effect || effect.type !== "saveHuman") {
      return;
    }
    await this.performHumanSave(effect);
  }

  private async flushSave(showFeedback: boolean): Promise<void> {
    await this.persistToDisk();
    if (showFeedback) {
      void vscode.window.setStatusBarMessage(
        `Saved ${path.basename(this.document.uri.fsPath)}`,
        2000
      );
    }
  }

  cancelPendingSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
  }

  private async executeSyncEffects(
    effects: SyncEffect[],
    reason: string
  ): Promise<void> {
    for (const effect of effects) {
      if (effect.type === "loadCanvas") {
        const content = this.contentByHash.get(effect.hash);
        if (!content) {
          outputChannel.appendLine(
            `[${reason}] missing content for ${effect.hash.slice(0, 8)}`
          );
          continue;
        }
        this.pendingLoadContent.set(effect.generation, content);
        void this.panel.webview.postMessage({
          type: "load",
          content,
          external: effect.origin !== "initial",
          generation: effect.generation,
          hash: effect.hash,
          origin: effect.origin,
          agentTurn: this.agentTurnActive,
        });
        outputChannel.appendLine(
          `[${reason}] load generation ${effect.generation} (${effect.hash.slice(0, 8)})`
        );
        continue;
      }

      if (effect.type === "preserveConflict") {
        await this.preserveAgentConflict(effect);
        this.cancelPendingSave();
        await this.persistToDisk();
        continue;
      }

      if (effect.type === "saveHuman") {
        await this.performHumanSave(effect);
      }
    }
  }

  private async performHumanSave(
    effect: Extract<SyncEffect, { type: "saveHuman" }>
  ): Promise<void> {
    const humanContent =
      this.contentByHash.get(effect.humanHash) ??
      (this.document.getHash() === effect.humanHash
        ? this.document.getText()
        : undefined);
    if (!humanContent) {
      this.sync.humanSaveFailed();
      outputChannel.appendLine(
        `[autosave] missing human revision ${effect.humanHash.slice(0, 8)}`
      );
      return;
    }

    try {
      const bytes = new TextEncoder().encode(humanContent);
      const result = await this.document.saveIfDiskHash(
        effect.expectedDiskHash,
        bytes
      );
      if (!result.saved) {
        const agentContent = new TextDecoder().decode(result.content);
        if (classifyDiagramText(agentContent) !== "valid") {
          this.sync.humanSaveFailed();
          outputChannel.appendLine(
            "[autosave] disk JSON is temporarily invalid; keeping human revision dirty"
          );
          return;
        }
        this.contentByHash.set(result.hash, agentContent);
        const conflicts = this.sync.humanSaveLostRace(result.hash);
        await this.executeSyncEffects(conflicts, "save-race");
        return;
      }

      this.sync.humanSaveSucceeded(effect.humanHash);
      outputChannel.appendLine(
        `[autosave] ${path.basename(this.document.uri.fsPath)} (${effect.humanHash.slice(0, 8)})`
      );
      if (this.sync.snapshot().phase === "humanDirty") {
        this.scheduleAutoSave();
      }
    } catch (error) {
      this.sync.humanSaveFailed();
      this.scheduleAutoSave();
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `Failed to save Excalidraw file: ${message}`
      );
    }
  }

  private async preserveAgentConflict(
    effect: Extract<SyncEffect, { type: "preserveConflict" }>
  ): Promise<void> {
    const agentContent = this.contentByHash.get(effect.agentHash);
    if (!agentContent) {
      return;
    }
    const filePath = this.document.uri.fsPath;
    const ext = path.extname(filePath);
    const uriPath = this.document.uri.path;
    const basePath = uriPath.slice(0, uriPath.length - ext.length);
    const candidateUri = this.document.uri.with({
      path: `${basePath}.agent-conflict${ext}`,
    });
    const metadataUri = this.document.uri.with({
      path: `${basePath}.agent-conflict.json`,
    });
    await vscode.workspace.fs.writeFile(
      candidateUri,
      new TextEncoder().encode(agentContent)
    );
    await vscode.workspace.fs.writeFile(
      metadataUri,
      new TextEncoder().encode(
        JSON.stringify(
          {
            diagram: path.basename(filePath),
            createdAt: new Date().toISOString(),
            baseHash: effect.baseHash,
            humanHash: effect.humanHash,
            agentHash: effect.agentHash,
            policy: "human-open-session-wins",
            candidate: path.basename(candidateUri.fsPath),
          },
          null,
          2
        )
      )
    );
    outputChannel.appendLine(
      `[conflict] preserved agent revision → ${path.basename(candidateUri.fsPath)}`
    );
    if (this.conflictNotificationOpen) {
      return;
    }
    this.conflictNotificationOpen = true;
    void vscode.window
      .showWarningMessage(
        "Agent changed this diagram while you had unsaved canvas edits. Your canvas was kept; agent version was preserved.",
        "Open Agent Version",
        "Replace With Agent Version"
      )
      .then(async (choice) => {
        this.conflictNotificationOpen = false;
        if (choice === "Open Agent Version") {
          await vscode.commands.executeCommand("vscode.open", candidateUri);
          return;
        }
        if (choice === "Replace With Agent Version") {
          const candidate = await vscode.workspace.fs.readFile(candidateUri);
          const candidateHash = hashContent(candidate);
          const content = new TextDecoder().decode(candidate);
          const current = await vscode.workspace.fs.readFile(this.document.uri);
          const result = await this.document.saveIfDiskHash(
            hashContent(current),
            candidate
          );
          if (!result.saved) {
            void vscode.window.showWarningMessage(
              "Diagram changed again before agent version could replace it. Try again."
            );
            return;
          }
          this.contentByHash.set(candidateHash, content);
          await this.executeSyncEffects(
            this.sync.acceptExternal(candidateHash),
            "conflict-resolution"
          );
        }
      });
  }

  private isHumanDirty(): boolean {
    const phase = this.sync.snapshot().phase;
    return (
      phase === "humanDirty" ||
      phase === "savingHuman" ||
      phase === "agentConflict"
    );
  }

  private readDiskBytes(): Uint8Array | undefined {
    const filePath = this.document.uri.fsPath;
    if (!filePath || !fs.existsSync(filePath)) {
      return undefined;
    }

    return fs.readFileSync(filePath);
  }

  private watchExternalChanges(): void {
    this.setupDiskWatchDebounce(this.diskWatchDelayMs);
    const schedulePush = () => {
      void this.refreshAgentTurnState("watch");
      this.diskWatchSchedulePush?.();
    };
    const scheduleAgentTurnCheck = debounce(() => {
      void this.refreshAgentTurnState("watch");
    }, AGENT_TURN_WATCH_DEBOUNCE_MS);

    void this.refreshAgentTurnState("init");

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(this.document.uri);
    if (workspaceFolder) {
      const relativePath = path.relative(workspaceFolder.uri.fsPath, this.document.uri.fsPath);
      if (relativePath && relativePath !== ".") {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(workspaceFolder, relativePath)
        );

        watcher.onDidChange(schedulePush);
        watcher.onDidCreate(schedulePush);
        this.disposables.push(watcher);
      }
    }

    const filePath = this.document.uri.fsPath;
    if (filePath && fs.existsSync(filePath)) {
      const nativeWatcher = fs.watch(filePath, schedulePush);
      this.disposables.push(
        new vscode.Disposable(() => {
          nativeWatcher.close();
        })
      );

      const lockPath = agentTurnLockPath(filePath);
      const lockDir = path.dirname(lockPath);
      const lockName = path.basename(lockPath);
      try {
        const lockWatcher = fs.watch(lockDir, (_event, filename) => {
          if (filename?.toString() === lockName) {
            scheduleAgentTurnCheck();
          }
        });
        this.disposables.push(
          new vscode.Disposable(() => {
            lockWatcher.close();
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(
          `[watch] agent-turn lock watcher unavailable: ${message}`
        );
      }
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "webview.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "webview.css")
    );
    return WEBVIEW_HTML.replace(/__NONCE__/g, nonce)
      .replace("__SCRIPT_URI__", scriptUri.toString())
      .replace("__STYLE_URI__", styleUri.toString());
  }

  dispose(): void {
    if (this.isHumanDirty()) {
      void this.persistToDisk();
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    if (this.lintTimer) {
      clearTimeout(this.lintTimer);
    }
    for (const pending of this.pendingSelectionRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Editor closed."));
    }
    this.pendingSelectionRequests.clear();
    for (const pending of this.pendingSelectionElementsRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Editor closed."));
    }
    this.pendingSelectionElementsRequests.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

function debounce(fn: () => void, delayMs: number): () => void {
  let timer: NodeJS.Timeout | undefined;
  return () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(fn, delayMs);
  };
}
