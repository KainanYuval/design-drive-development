import * as vscode from "vscode";

export const DESIGNS_ROOT_DIR = ".designs";
export const DESIGN_GROUPS_DIR = ".designs/groups";
export const DESIGN_CONSENT_KEY_PREFIX = "design-drive-development.designsConsent:";

export function designsConsentKey(folder: vscode.WorkspaceFolder): string {
  return `${DESIGN_CONSENT_KEY_PREFIX}${folder.uri.toString()}`;
}

export async function hasDesignsFolder(folder: vscode.WorkspaceFolder): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, DESIGNS_ROOT_DIR));
    return true;
  } catch {
    return false;
  }
}

export async function ensureDesignsFolderConsent(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder
): Promise<boolean> {
  const consentKey = designsConsentKey(folder);
  if (context.workspaceState.get<boolean>(consentKey)) {
    return true;
  }

  if (await hasDesignsFolder(folder)) {
    await context.workspaceState.update(consentKey, true);
    return true;
  }

  const answer = await vscode.window.showInformationMessage(
    "Saved diagram components live in a separate `.designs/` branch of this repo (not mixed into your `.excalidraw` files). Create `.designs` now?",
    { modal: true },
    "Yes, create .designs",
    "No"
  );

  if (answer !== "Yes, create .designs") {
    return false;
  }

  await context.workspaceState.update(consentKey, true);
  return true;
}
