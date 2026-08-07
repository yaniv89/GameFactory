import { useEffect, useRef, useState } from "react";
import { useCanvasPreviewStore } from "../canvas/canvasPreviewStore";
import { isPreviewToEditorMessage, type EditorToPreviewMessage } from "../preview/protocol";
import "./PreviewPanel.css";

type PreviewPanelStatus = "loading" | "ready" | "error";

/**
 * The editor's end of the cross-origin preview bridge (docs/SPEC.md
 * 10.6). The `<iframe sandbox="allow-scripts">` — no `allow-same-origin`
 * — gets a browser-enforced opaque origin regardless of what URL it's
 * actually served from, which is the real isolation boundary here: a
 * compromised preview cannot reach this window, its storage, or its
 * tokens, whether or not `play.forge.dev` exists yet as a literal second
 * domain (it doesn't — there is no deployment topology until M5/M6).
 *
 * Verified empirically, not assumed (a real MessageEvent.origin from a
 * sandboxed iframe is exactly the string "null", confirmed with a
 * throwaway two-page Playwright probe before writing this): messages
 * *from* the iframe are validated by that opaque "null" origin plus
 * `event.source` identity, since a domain comparison isn't available in
 * that direction. Messages *to* the iframe cannot target a specific
 * origin string either — the same opaqueness means only `"*"` is ever
 * delivered — so outbound trust instead comes from holding the iframe's
 * own `contentWindow` reference directly (we created it, we know what
 * `src` we gave it, nothing else can substitute for that reference).
 *
 * State coverage (CLAUDE.md 5.4): same reasoning as SceneCanvas — only
 * Loading and Error are real yet. Empty/Permission-denied/Offline don't
 * have real meaning without a backend or a persisted scene document.
 */
export function PreviewPanel() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<PreviewPanelStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const tiles = useCanvasPreviewStore((state) => state.tiles);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== "null") return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isPreviewToEditorMessage(event.data)) return;
      if (event.data.type === "forge:preview:ready") {
        setStatus("ready");
        setErrorMessage(undefined);
      } else {
        setStatus("error");
        setErrorMessage(event.data.message);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Pushes the latest tile snapshot once the preview has confirmed it's
  // ready to receive one — sending earlier would race the preview's own
  // RenderHost boot.
  useEffect(() => {
    if (status !== "ready" || !tiles) return;
    const message: EditorToPreviewMessage = { type: "forge:preview:tiles", tiles };
    iframeRef.current?.contentWindow?.postMessage(message, "*");
  }, [status, tiles]);

  return (
    <div className="fg-preview-panel">
      {status === "loading" && (
        <div className="fg-preview-panel__overlay" role="status" aria-label="Starting the preview">
          Starting the preview…
        </div>
      )}
      {status === "error" && (
        <div className="fg-preview-panel__overlay fg-preview-panel__overlay--error" role="alert">
          <p>Couldn&rsquo;t start the preview.</p>
          <p className="fg-preview-panel__error-detail">{errorMessage}</p>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src="/preview.html"
        title="Live preview"
        className="fg-preview-panel__frame"
        sandbox="allow-scripts"
      />
    </div>
  );
}
