import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasPreviewStore } from "../canvas/canvasPreviewStore";
import { loadDevPreview, saveDevPreview, type DevPreviewSave } from "../preview/devPreviewSave";
import { useProjectStore } from "../store/projectStore";
import { PreviewPanel } from "./PreviewPanel";

const SAMPLE_SAVE: DevPreviewSave = {
  player: { Transform: { x: 1, y: 2, rotation: 0, scaleX: 1, scaleY: 1 } },
  inventory: { coin: 3 },
  savedAt: "2026-08-20T00:00:00.000Z",
};

function getIframe(): HTMLIFrameElement {
  return document.querySelector(".fg-preview-panel__frame") as HTMLIFrameElement;
}

function dispatchFromIframe(data: unknown, options: { origin?: string; sourceIsIframe?: boolean } = {}): void {
  const { origin = "null", sourceIsIframe = true } = options;
  const source = sourceIsIframe ? getIframe().contentWindow : window;
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
  });
}

describe("PreviewPanel", () => {
  beforeEach(() => {
    useCanvasPreviewStore.setState({ tiles: undefined });
    useProjectStore.setState({
      document: { scenes: [], installedModules: {}, activePack: undefined, packOverrides: {}, packTerrainRemap: {}, graphs: {} },
      past: [],
      future: [],
      checkpoints: [],
      selection: undefined,
    });
    window.localStorage.clear();
  });

  it("shows the loading overlay before the iframe reports ready", () => {
    render(<PreviewPanel />);
    expect(screen.getByRole("status", { name: "Starting the preview" })).toBeInTheDocument();
  });

  it("hides the loading overlay once the iframe reports forge:preview:ready", () => {
    render(<PreviewPanel />);
    dispatchFromIframe({ type: "forge:preview:ready" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows an error overlay with the message when the iframe reports forge:preview:error", () => {
    render(<PreviewPanel />);
    dispatchFromIframe({ type: "forge:preview:error", message: "No available renderer" });
    expect(screen.getByRole("alert")).toHaveTextContent("No available renderer");
  });

  it("ignores a message whose origin isn't the sandboxed iframe's opaque \"null\" origin", () => {
    render(<PreviewPanel />);
    dispatchFromIframe({ type: "forge:preview:ready" }, { origin: "http://evil.example" });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("ignores a message not sourced from the iframe's own contentWindow", () => {
    render(<PreviewPanel />);
    dispatchFromIframe({ type: "forge:preview:ready" }, { sourceIsIframe: false });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("ignores a malformed message shape", () => {
    render(<PreviewPanel />);
    dispatchFromIframe({ type: "forge:preview:ready:typo" });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("posts the current tile snapshot and this scene's entities once the iframe reports ready", () => {
    useCanvasPreviewStore.setState({ tiles: [1, 2, 3] });
    act(() => useProjectStore.getState().createScene());
    const sceneId = useProjectStore.getState().document.scenes[0]!.id;
    act(() => useProjectStore.getState().placeNpc(sceneId, 2, 2));
    const entities = useProjectStore.getState().document.scenes[0]!.entities;

    render(<PreviewPanel />);
    const postMessageSpy = vi.spyOn(getIframe().contentWindow as Window, "postMessage");

    dispatchFromIframe({ type: "forge:preview:ready" });

    expect(postMessageSpy).toHaveBeenCalledWith({ type: "forge:preview:scene", tiles: [1, 2, 3], entities, installedModules: [], graphs: {} }, "*");
  });

  it("does not post tiles before the iframe has reported ready", () => {
    useCanvasPreviewStore.setState({ tiles: [1, 2, 3] });
    render(<PreviewPanel />);
    const postMessageSpy = vi.spyOn(getIframe().contentWindow as Window, "postMessage");

    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it("renders the iframe with sandbox=\"allow-scripts\" and no allow-same-origin", () => {
    render(<PreviewPanel />);
    const iframe = getIframe();
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  });

  describe("I1f: dev-preview save/restore bridge", () => {
    it("includes this browser's last dev-preview save in the first scene message, then omits it from later ones", () => {
      saveDevPreview(SAMPLE_SAVE);
      useCanvasPreviewStore.setState({ tiles: [1, 2, 3] });

      render(<PreviewPanel />);
      const postMessageSpy = vi.spyOn(getIframe().contentWindow as Window, "postMessage");
      dispatchFromIframe({ type: "forge:preview:ready" });

      expect(postMessageSpy).toHaveBeenNthCalledWith(1, { type: "forge:preview:scene", tiles: [1, 2, 3], entities: [], installedModules: [], graphs: {}, devSave: SAMPLE_SAVE }, "*");

      act(() => useCanvasPreviewStore.setState({ tiles: [4, 5, 6] }));
      expect(postMessageSpy).toHaveBeenNthCalledWith(2, { type: "forge:preview:scene", tiles: [4, 5, 6], entities: [], installedModules: [], graphs: {} }, "*");
    });

    it("sends no devSave field when this browser has no dev-preview save", () => {
      useCanvasPreviewStore.setState({ tiles: [1, 2, 3] });
      render(<PreviewPanel />);
      const postMessageSpy = vi.spyOn(getIframe().contentWindow as Window, "postMessage");
      dispatchFromIframe({ type: "forge:preview:ready" });
      expect(postMessageSpy).toHaveBeenCalledWith({ type: "forge:preview:scene", tiles: [1, 2, 3], entities: [], installedModules: [], graphs: {} }, "*");
    });

    it("persists a forge:preview:save message from the iframe to this browser's localStorage — the only place the sandboxed preview's save can actually land", () => {
      render(<PreviewPanel />);
      expect(loadDevPreview()).toBeNull();
      dispatchFromIframe({ type: "forge:preview:save", save: SAMPLE_SAVE });
      expect(loadDevPreview()).toEqual(SAMPLE_SAVE);
    });

    it("ignores a forge:preview:save whose save payload doesn't structurally match DevPreviewSave", () => {
      render(<PreviewPanel />);
      dispatchFromIframe({ type: "forge:preview:save", save: { player: "not-an-object" } });
      expect(loadDevPreview()).toBeNull();
    });
  });
});
