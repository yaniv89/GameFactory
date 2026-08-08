import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SceneInspector } from "./SceneInspector";

describe("SceneInspector", () => {
  it("shows the scene's current name", () => {
    render(<SceneInspector scene={{ id: "s1", name: "Village", entities: [], tiles: [] }} onRename={() => {}} />);
    expect(screen.getByLabelText("Name")).toHaveValue("Village");
  });

  it("calls onRename with the scene id and the new name once the field is blurred", async () => {
    const onRename = vi.fn();
    render(<SceneInspector scene={{ id: "s1", name: "Village", entities: [], tiles: [] }} onRename={onRename} />);

    const nameField = screen.getByLabelText("Name");
    await userEvent.clear(nameField);
    await userEvent.type(nameField, "Riverside");
    await userEvent.tab();

    expect(onRename).toHaveBeenCalledWith("s1", "Riverside");
  });

  it("does not call onRename when the field is blurred with an empty name", async () => {
    const onRename = vi.fn();
    render(<SceneInspector scene={{ id: "s1", name: "Village", entities: [], tiles: [] }} onRename={onRename} />);

    const nameField = screen.getByLabelText("Name");
    await userEvent.clear(nameField);
    await userEvent.tab();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onRename).not.toHaveBeenCalled();
  });
});
