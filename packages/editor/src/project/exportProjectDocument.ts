import type { ProjectDocument } from "@forge/project-export";

/**
 * The file the "Export Project" toolbar button downloads — the editor's
 * own `ProjectDocument` plus the `projectId` a pure `ProjectDocument`
 * doesn't carry (`@forge/project-export`'s `toExportProjectInput` needs
 * it, docs/adr/0009). `forge export --document <this file> --out <dir>`
 * (packages/cli/src/commands/export.ts's `ProjectDocumentExportFile`,
 * the same shape by construction — not just by convention) is the other
 * half of this: this button hands a creator a real, playable game the
 * moment they have Node and the CLI installed, without a hosted publish
 * pipeline existing yet (a separate, later piece of work).
 */
export interface ProjectDocumentExportFile {
  readonly projectId: string;
  readonly document: ProjectDocument;
}

export function buildProjectDocumentExportFile(projectId: string, projectDocument: ProjectDocument): ProjectDocumentExportFile {
  return { projectId, document: projectDocument };
}

/**
 * Triggers a real browser download of `file` as pretty-printed JSON — no
 * server round trip, the document already lives entirely client-side.
 * `URL.revokeObjectURL` is deferred a tick rather than called
 * synchronously right after `click()`: revoking immediately can race the
 * browser's own (asynchronous) handoff to its download manager in some
 * engines, before it has actually read the blob.
 */
export function downloadProjectDocumentExportFile(file: ProjectDocumentExportFile, filename: string): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
