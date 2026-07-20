import * as path from "node:path";
import * as vscode from "vscode";
import { lintDiagramJson, type DiagramLintIssue } from "./diagramLint";
import { findElementLineRange } from "./selectionReference";

const LINT_SOURCE = "design-drive-development-lint";

export function lintSidecarUri(diagramUri: vscode.Uri): vscode.Uri {
  const dir = path.dirname(diagramUri.fsPath);
  const base = path.basename(diagramUri.fsPath, ".excalidraw");
  return vscode.Uri.file(path.join(dir, `${base}.diagram-lint.json`));
}

export class DiagramLintReporter {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly output: vscode.OutputChannel;

  constructor(output: vscode.OutputChannel) {
    this.collection = vscode.languages.createDiagnosticCollection(LINT_SOURCE);
    this.output = output;
  }

  dispose(): void {
    this.collection.dispose();
  }

  async publish(uri: vscode.Uri, diagramText: string): Promise<DiagramLintIssue[]> {
    const issues = lintDiagramJson(diagramText);
    const diagnostics = issues
      .map((issue) => toDiagnostic(issue, diagramText))
      .filter((d): d is vscode.Diagnostic => d !== undefined);

    this.collection.set(uri, diagnostics);

    await this.writeSidecar(uri, issues);

    if (issues.length > 0) {
      this.output.appendLine(
        `[lint] ${path.basename(uri.fsPath)} — ${issues.length} issue(s) → ${path.basename(lintSidecarUri(uri).fsPath)}`
      );
      for (const issue of issues.slice(0, 8)) {
        this.output.appendLine(`  · ${issue.severity} ${issue.code} @ ${issue.elementId}: ${issue.message}`);
      }
      if (issues.length > 8) {
        this.output.appendLine(`  · … +${issues.length - 8} more`);
      }
    } else {
      this.output.appendLine(`[lint] ${path.basename(uri.fsPath)} — OK`);
    }

    return issues;
  }

  clear(uri: vscode.Uri): void {
    this.collection.delete(uri);
  }

  private async writeSidecar(uri: vscode.Uri, issues: DiagramLintIssue[]): Promise<void> {
    const sidecar = lintSidecarUri(uri);
    const payload = {
      diagram: path.basename(uri.fsPath),
      generatedAt: new Date().toISOString(),
      issueCount: issues.length,
      issues: issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        elementId: issue.elementId,
        message: issue.message,
        hint: issue.elementId
          ? `Read \`${path.basename(uri.fsPath)}\` element id \`${issue.elementId}\` and patch layout.`
          : undefined,
      })),
      agentNote:
        issues.length > 0
          ? "Fix layout issues before ending the design turn. Prefer orthogonal arrows and labels that fit inside boxes."
          : "No layout lint issues detected.",
    };

    try {
      await vscode.workspace.fs.writeFile(
        sidecar,
        Buffer.from(JSON.stringify(payload, null, 2), "utf8")
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[lint] failed to write sidecar: ${message}`);
    }
  }
}

function toDiagnostic(issue: DiagramLintIssue, fileText: string): vscode.Diagnostic | undefined {
  let line = 0;
  if (issue.elementId) {
    const range = findElementLineRange(fileText, issue.elementId);
    if (range) {
      line = Math.max(0, range.start - 1);
    }
  }

  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(line, 0, line, 1),
    `[${issue.code}] ${issue.message}`,
    issue.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
  );
  diagnostic.source = "DDD layout";
  diagnostic.code = issue.code;
  return diagnostic;
}
