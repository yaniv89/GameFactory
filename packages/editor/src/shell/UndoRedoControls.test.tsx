import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "../store/projectStore";
import { UndoRedoControls } from "./UndoRedoControls";

function reset(): void {
  localStorage.clear();
  useProjectStore.setState({
    document: { scenes: [], installedModules: {}, activePack: undefined, packOverrides: {} },
    past: [],
    future: [],
    selection: undefined,
  });
}

describe("UndoRedoControls", () => {
  beforeEach(reset);

  it("disables both buttons when there is no history", () => {
    render(<UndoRedoControls />);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("enables Undo once a command has been dispatched, and Redo after undoing it", async () => {
    render(<UndoRedoControls />);
    act(() => useProjectStore.getState().createScene());
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(useProjectStore.getState().document.scenes).toEqual([]);
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(useProjectStore.getState().document.scenes).toHaveLength(1);
  });

  it("Ctrl+Z undoes and Ctrl+Shift+Z redoes", async () => {
    render(<UndoRedoControls />);
    useProjectStore.getState().createScene();
    expect(useProjectStore.getState().document.scenes).toHaveLength(1);

    await userEvent.keyboard("{Control>}z{/Control}");
    expect(useProjectStore.getState().document.scenes).toEqual([]);

    await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(useProjectStore.getState().document.scenes).toHaveLength(1);
  });

  it("does not fire the shortcut while a text input has focus", async () => {
    render(
      <>
        <UndoRedoControls />
        <input aria-label="scene name" />
      </>,
    );
    act(() => useProjectStore.getState().createScene());
    await userEvent.click(screen.getByRole("textbox", { name: "scene name" }));
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(useProjectStore.getState().document.scenes).toHaveLength(1);
  });
});
