import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuestsPanel } from "./QuestsPanel";

const NOOP = () => {};

const KILL_WOLVES = {
  id: "q1",
  name: "Wolf Trouble",
  description: "Deal with the wolves near the mill.",
  objectives: [{ id: "o1", description: "Kill 3 wolves" }],
};

describe("QuestsPanel", () => {
  it("shows the empty-state copy and fires onCreateQuest", async () => {
    const onCreateQuest = vi.fn();
    render(<QuestsPanel state="empty" onCreateQuest={onCreateQuest} />);
    expect(screen.getByText("No quests yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create a quest" }));
    expect(onCreateQuest).toHaveBeenCalledOnce();
  });

  it("lists quests with their name, description, id, and objectives when populated", () => {
    render(<QuestsPanel state="populated" onCreateQuest={NOOP} quests={[KILL_WOLVES]} />);
    expect(screen.getByDisplayValue("Wolf Trouble")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Deal with the wolves near the mill.")).toBeInTheDocument();
    expect(screen.getByText("q1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Kill 3 wolves")).toBeInTheDocument();
    expect(screen.getByText("o1")).toBeInTheDocument();
  });

  it("fires onEditQuest with both fields when the quest form is blurred", async () => {
    const onEditQuest = vi.fn();
    render(<QuestsPanel state="populated" onCreateQuest={NOOP} onEditQuest={onEditQuest} quests={[KILL_WOLVES]} />);
    const input = screen.getByDisplayValue("Wolf Trouble");
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed{Tab}");
    expect(onEditQuest).toHaveBeenCalledWith("q1", "Renamed", "Deal with the wolves near the mill.");
  });

  it("fires onEditObjective when an objective's description is blurred", async () => {
    const onEditObjective = vi.fn();
    render(<QuestsPanel state="populated" onCreateQuest={NOOP} onEditObjective={onEditObjective} quests={[KILL_WOLVES]} />);
    const input = screen.getByDisplayValue("Kill 3 wolves");
    await userEvent.clear(input);
    await userEvent.type(input, "Kill 5 wolves{Tab}");
    expect(onEditObjective).toHaveBeenCalledWith("q1", "o1", "Kill 5 wolves");
  });

  it("fires onAddObjective, onRemoveObjective, and onDeleteQuest from their buttons", async () => {
    const onAddObjective = vi.fn();
    const onRemoveObjective = vi.fn();
    const onDeleteQuest = vi.fn();
    render(
      <QuestsPanel
        state="populated"
        onCreateQuest={NOOP}
        onAddObjective={onAddObjective}
        onRemoveObjective={onRemoveObjective}
        onDeleteQuest={onDeleteQuest}
        quests={[KILL_WOLVES]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Add objective" }));
    expect(onAddObjective).toHaveBeenCalledWith("q1");
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemoveObjective).toHaveBeenCalledWith("q1", "o1");
    await userEvent.click(screen.getByRole("button", { name: "Delete quest" }));
    expect(onDeleteQuest).toHaveBeenCalledWith("q1");
  });

  it("always shows a 'New quest' action, even when populated", () => {
    render(<QuestsPanel state="populated" onCreateQuest={NOOP} quests={[KILL_WOLVES]} />);
    expect(screen.getByRole("button", { name: "New quest" })).toBeInTheDocument();
  });
});
