import { Button, Tooltip } from "@forge/ds";
import { useEffect } from "react";
import { selectCanRedo, selectCanUndo, useProjectStore } from "../store/projectStore";
import "./UndoRedoControls.css";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD_LABEL = IS_MAC ? "Cmd" : "Ctrl";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

/**
 * Toolbar buttons plus the global Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z shortcut
 * (CLAUDE.md 5.3 "keyboard first, everywhere"). Skips the shortcut while
 * an input/textarea/contentEditable has focus so it doesn't fight a
 * text field's own native undo once one exists (Phase 4's inspector).
 */
export function UndoRedoControls() {
  const canUndo = useProjectStore(selectCanUndo);
  const canRedo = useProjectStore(selectCanRedo);
  const undo = useProjectStore((state) => state.undo);
  const redo = useProjectStore((state) => state.redo);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modPressed = IS_MAC ? event.metaKey : event.ctrlKey;
      if (!modPressed || event.key.toLowerCase() !== "z" || isEditableTarget(event.target)) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  return (
    <div className="fg-undo-redo" role="group" aria-label="Undo and redo">
      <Tooltip content={`Undo (${MOD_LABEL}+Z)`}>
        <Button variant="ghost" iconOnly aria-label="Undo" disabled={!canUndo} onClick={undo}>
          ↶
        </Button>
      </Tooltip>
      <Tooltip content={`Redo (${MOD_LABEL}+Shift+Z)`}>
        <Button variant="ghost" iconOnly aria-label="Redo" disabled={!canRedo} onClick={redo}>
          ↷
        </Button>
      </Tooltip>
    </div>
  );
}
