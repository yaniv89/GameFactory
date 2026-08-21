import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EntityInspector } from "./EntityInspector";
import type { EntityPlacement } from "../store/projectStore";

const NPC: EntityPlacement = { id: "e1", prefabId: "npc", tileX: 3, tileY: 4 };
const PLAYER_START: EntityPlacement = { id: "e2", prefabId: "player-start", tileX: 1, tileY: 1 };

describe("EntityInspector", () => {
  it("shows a dialogue form for an npc", () => {
    render(<EntityInspector entity={NPC} onConfigureDialogue={() => {}} onRemove={() => {}} />);
    expect(screen.getByLabelText("Speaker")).toBeInTheDocument();
    expect(screen.getByLabelText("Line")).toBeInTheDocument();
  });

  it("pre-fills the form with the npc's existing dialogue (its first node)", () => {
    const npcWithDialogue: EntityPlacement = { ...NPC, dialogue: { nodes: [{ speaker: "Shopkeeper", text: "Welcome!" }] } };
    render(<EntityInspector entity={npcWithDialogue} onConfigureDialogue={() => {}} onRemove={() => {}} />);
    expect(screen.getByLabelText("Speaker")).toHaveValue("Shopkeeper");
    expect(screen.getByLabelText("Line")).toHaveValue("Welcome!");
  });

  it("calls onConfigureDialogue with the entity id and a one-node tree once blurred", async () => {
    const onConfigureDialogue = vi.fn();
    render(<EntityInspector entity={NPC} onConfigureDialogue={onConfigureDialogue} onRemove={() => {}} />);

    await userEvent.type(screen.getByLabelText("Speaker"), "Shopkeeper");
    await userEvent.type(screen.getByLabelText("Line"), "Welcome to my shop!");
    await userEvent.tab();

    expect(onConfigureDialogue).toHaveBeenCalledWith("e1", { nodes: [{ speaker: "Shopkeeper", text: "Welcome to my shop!" }] });
  });

  it("editing the first line leaves further nodes and that node's own choices untouched", async () => {
    const onConfigureDialogue = vi.fn();
    const branching: EntityPlacement = {
      ...NPC,
      dialogue: {
        nodes: [
          { speaker: "Elder", text: "Choose wisely.", choices: [{ id: "yes", text: "I will.", next: 1 }] },
          { speaker: "Elder", text: "Good choice." },
        ],
      },
    };
    render(<EntityInspector entity={branching} onConfigureDialogue={onConfigureDialogue} onRemove={() => {}} />);

    await userEvent.clear(screen.getByLabelText("Line"));
    await userEvent.type(screen.getByLabelText("Line"), "Choose carefully.");
    await userEvent.tab();

    expect(onConfigureDialogue).toHaveBeenCalledWith("e1", {
      nodes: [
        { speaker: "Elder", text: "Choose carefully.", choices: [{ id: "yes", text: "I will.", next: 1 }] },
        { speaker: "Elder", text: "Good choice." },
      ],
    });
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
