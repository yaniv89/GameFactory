import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProjectDocumentExportFile, downloadProjectDocumentExportFile } from "./exportProjectDocument";
import { migrateDocument } from "../store/projectStore";

describe("buildProjectDocumentExportFile", () => {
  it("wraps the document with the projectId toExportProjectInput needs", () => {
    const document = migrateDocument(undefined);
    const file = buildProjectDocumentExportFile("proj-1", document);
    expect(file).toEqual({ projectId: "proj-1", document });
  });
});

describe("downloadProjectDocumentExportFile", () => {
  const createObjectURL = vi.fn(() => "blob:mock-url");
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  it("triggers a real anchor-click download with the given filename, then revokes the object URL", () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const document = migrateDocument(undefined);
    const file = buildProjectDocumentExportFile("proj-1", document);

    downloadProjectDocumentExportFile(file, "my-project.json");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled(); // deferred to next tick, not synchronous
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    clickSpy.mockRestore();
  });
});
