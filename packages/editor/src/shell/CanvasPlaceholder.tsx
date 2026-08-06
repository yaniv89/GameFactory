import "./CanvasPlaceholder.css";

/**
 * The real scene canvas (PixiJS via @forge/render-2d, tile paint, camera,
 * selection) is M4 Phase 2. This placeholder exists so the shell's layout
 * — the "lit worktable" (CLAUDE.md 5.1): a warmer, lighter canvas field
 * against cooler surrounding chrome — is structurally correct from Phase 1
 * onward, not bolted on later. It states plainly what it is, not a fake
 * loading spinner implying the canvas is "coming any second."
 */
export function CanvasPlaceholder() {
  return (
    <div className="fg-canvas-placeholder">
      <p>The scene canvas is built in M4 Phase 2.</p>
    </div>
  );
}
