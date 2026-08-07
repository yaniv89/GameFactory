import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasPreviewStore } from "../canvas/canvasPreviewStore";
import { PreviewPanel } from "./PreviewPanel";

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

  it("posts the current tile snapshot to the iframe once it reports ready", () => {
    useCanvasPreviewStore.setState({ tiles: [1, 2, 3] });
    render(<PreviewPanel />);
    const postMessageSpy = vi.spyOn(getIframe().contentWindow as Window, "postMessage");

    dispatchFromIframe({ type: "forge:preview:ready" });

    expect(postMessageSpy).toHaveBeenCalledWith({ type: "forge:preview:tiles", tiles: [1, 2, 3] }, "*");
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
});
