import { useEffect, useRef, useState } from "react";
import { useCanvasPreviewStore } from "../canvas/canvasPreviewStore";
import { loadDevPreview, saveDevPreview, type DevPreviewSave } from "../preview/devPreviewSave";
import { isPreviewToEditorMessage, type EditorToPreviewMessage } from "../preview/protocol";
import { useProjectStore } from "../store/projectStore";
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
  /**
   * I1f: this browser's last dev-preview save, if any. `useRef`'s
   * argument is only ever consulted on the component's first render (the
   * same "cheap enough to call directly, no lazy-initializer form needed"
   * shape `useState` reserves a function-argument form for), so
   * `loadDevPreview()` — one `localStorage.getItem` + `JSON.parse` — runs
   * once here, not per render. Handed to the preview on the first
   * `forge:preview:scene` send below, then cleared so it isn't repeated
   * on every subsequent tile paint. Read here, not inside the sandboxed
   * iframe: `devPreviewSave.ts`'s own doc comment has the
   * confirmed-empirically reason (`localStorage` throws from that
   * document's opaque origin).
   */
  const devSaveRef = useRef<DevPreviewSave | null>(loadDevPreview());
  const tiles = useCanvasPreviewStore((state) => state.tiles);
  // Entities are already real projectStore state (unlike tiles, which
  // live inside an imperative TilemapLayer — see canvasPreviewStore's
  // doc comment) — read directly rather than bouncing through a second
  // bridge store. Scoped to scenes[0]: SceneCanvas doesn't have a
  // scene-tab/"active scene" concept yet (Phase 7's documented gap).
  const entities = useProjectStore((state) => state.document.scenes[0]?.entities);
  const activePack = useProjectStore((state) => state.document.activePack);
  // issue #123: the real, live install list — not a snapshot taken once at
  // boot. Re-sent on every `forge:preview:scene` message (the same
  // cadence `tiles`/`entities` already use), so uninstalling a module from
  // the Modules panel takes effect in the running preview immediately,
  // the same tick it would in a fresh export. Selects the `immer`-managed
  // object itself, not `Object.keys(...)` of it — the latter would return
  // a fresh array (and so a changed reference) on every store update
  // whether or not `installedModules` actually changed, over-firing the
  // scene-send effect below; `Object.keys` is computed inline there
  // instead, only when this reference has genuinely changed.
  const installedModules = useProjectStore((state) => state.document.installedModules);
  // docs/adr/0017 (M6): the real, live authored-graph set, re-sent on
  // every scene message exactly like installedModules above — editing a
  // graph in GraphsPanel should reach the running preview the same tick
  // an install/uninstall would.
  const graphs = useProjectStore((state) => state.document.graphs);
  // docs/adr/0018 Decision 3 (M11): the real, live authored data-table
  // set, re-sent on every scene message exactly like graphs above —
  // editing a table in DataTablesPanel (M12) should reach the running
  // preview the same tick a graph edit would.
  const dataTables = useProjectStore((state) => state.document.dataTables);
  // docs/adr/0018 Decision 1 (M7/M13): every authored quest's static
  // definition. Re-sent on every scene message like graphs/dataTables
  // above, but PreviewApp.tsx only ever actually reads it once — see
  // `PreviewSceneMessage.quests`'s own doc comment (protocol.ts) for why
  // a quest's live definition can't be swapped mid-session the way a
  // graph can.
  const quests = useProjectStore((state) => state.document.quests);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== "null") return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isPreviewToEditorMessage(event.data)) return;
      if (event.data.type === "forge:preview:ready") {
        setStatus("ready");
        setErrorMessage(undefined);
      } else if (event.data.type === "forge:preview:save") {
        // I1f: the real write side — the preview iframe has no
        // `localStorage` of its own to write to (its opaque sandbox
        // origin), so this is the only place a dev-preview save is ever
        // actually persisted.
        saveDevPreview(event.data.save);
      } else {
        setStatus("error");
        setErrorMessage(event.data.message);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Pushes the latest scene snapshot once the preview has confirmed it's
  // ready to receive one — sending earlier would race the preview's own
  // RenderHost boot.
  useEffect(() => {
    if (status !== "ready" || !tiles) return;
    const message: EditorToPreviewMessage = {
      type: "forge:preview:scene",
      tiles,
      entities: entities ?? [],
      installedModules: Object.keys(installedModules),
      graphs,
      // Rows only — the same strip `toExportProjectInput.ts` applies
      // (`columns`/`name` are editor-only metadata nothing at runtime
      // reads, per `DataTableDefinition`'s own doc comment).
      dataTables: Object.fromEntries(Object.entries(dataTables).map(([id, table]) => [id, table.rows])),
      quests,
      ...(activePack !== undefined ? { activePack } : {}),
      ...(devSaveRef.current ? { devSave: devSaveRef.current } : {}),
    };
    devSaveRef.current = null; // sent (if there was one) — the preview itself is the source of truth for its own state from here on.
    // "*" is the only valid targetOrigin here, not a lazy default: the
    // iframe is sandbox="allow-scripts" with no allow-same-origin, so its
    // origin is browser-opaque — no literal origin string (including
    // "null") is ever accepted as a postMessage targetOrigin match for an
    // opaque destination, per spec. Trust instead comes from holding the
    // exact contentWindow reference this component created (see the
    // class doc comment above). Flagged by Semgrep's wildcard-postmessage
    // rule, which doesn't know about this architecture — real finding in
    // general, false positive for this specific, structurally-safe case.
    // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration
    iframeRef.current?.contentWindow?.postMessage(message, "*");
  }, [status, tiles, entities, activePack, installedModules, graphs, dataTables, quests]);

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
