import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScenesPanel } from "./ScenesPanel";

describe("ScenesPanel", () => {
  it("shows the empty-state copy and fires onCreateScene", async () => {
    const onCreateScene = vi.fn();
    render(<ScenesPanel state="empty" onCreateScene={onCreateScene} />);
    expect(screen.getByText("No scenes yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create a scene" }));
    expect(onCreateScene).toHaveBeenCalledOnce();
  });

  it("lists scenes when populated", () => {
    const scenes = [
      { id: "s1", name: "village" },
      { id: "s2", name: "cave-01" },
    ];
    render(<ScenesPanel state="populated" scenes={scenes} onCreateScene={() => {}} />);
    expect(screen.getByText("village")).toBeInTheDocument();
    expect(screen.getByText("cave-01")).toBeInTheDocument();
  });

  it("calls onSelectScene with the clicked scene's id", async () => {
    const onSelectScene = vi.fn();
    const scenes = [{ id: "s1", name: "village" }];
    render(
      <ScenesPanel state="populated" scenes={scenes} onCreateScene={() => {}} onSelectScene={onSelectScene} />,
    );
    await userEvent.click(screen.getByRole("treeitem", { name: "village" }));
    expect(onSelectScene).toHaveBeenCalledWith("s1");
  });

  it("fires onRetry from the error state", async () => {
    const onRetry = vi.fn();
    render(<ScenesPanel state="error" onCreateScene={() => {}} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
