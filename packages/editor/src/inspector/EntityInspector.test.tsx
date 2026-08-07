import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EntityInspector } from "./EntityInspector";
import type { EntityPlacement } from "../store/projectStore";

const NPC: EntityPlacement = { id: "e1", kind: "npc", tileX: 3, tileY: 4 };
const PLAYER_START: EntityPlacement = { id: "e2", kind: "player-start", tileX: 1, tileY: 1 };

describe("EntityInspector", () => {
  it("shows a dialogue form for an npc", () => {
    render(<EntityInspector entity={NPC} onConfigureDialogue={() => {}} onRemove={() => {}} />);
    expect(screen.getByLabelText("Speaker")).toBeInTheDocument();
    expect(screen.getByLabelText("Line")).toBeInTheDocument();
  });

  it("pre-fills the form with the npc's existing dialogue", () => {
    const npcWithDialogue: EntityPlacement = { ...NPC, dialogue: { speaker: "Shopkeeper", text: "Welcome!" } };
    render(<EntityInspector entity={npcWithDialogue} onConfigureDialogue={() => {}} onRemove={() => {}} />);
    expect(screen.getByLabelText("Speaker")).toHaveValue("Shopkeeper");
    expect(screen.getByLabelText("Line")).toHaveValue("Welcome!");
  });

  it("calls onConfigureDialogue with the entity id and new dialogue once blurred", async () => {
    const onConfigureDialogue = vi.fn();
    render(<EntityInspector entity={NPC} onConfigureDialogue={onConfigureDialogue} onRemove={() => {}} />);

    await userEvent.type(screen.getByLabelText("Speaker"), "Shopkeeper");
    await userEvent.type(screen.getByLabelText("Line"), "Welcome to my shop!");
    await userEvent.tab();

    expect(onConfigureDialogue).toHaveBeenCalledWith("e1", { speaker: "Shopkeeper", text: "Welcome to my shop!" });
  });

  it("shows no dialogue form for a player-start, only an informational hint", () => {
    render(<EntityInspector entity={PLAYER_START} onConfigureDialogue={() => {}} onRemove={() => {}} />);
    expect(screen.queryByLabelText("Speaker")).not.toBeInTheDocument();
    expect(screen.getByText(/spawns here/)).toBeInTheDocument();
  });

  it("calls onRemove with the entity id when Remove is clicked", async () => {
    const onRemove = vi.fn();
    render(<EntityInspector entity={NPC} onConfigureDialogue={() => {}} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledWith("e1");
  });
});
