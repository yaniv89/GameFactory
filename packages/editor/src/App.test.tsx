import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("mounts the shell and adds all eight panels via Dockview", async () => {
    render(<App />);
    expect(screen.getByText("Forge")).toBeInTheDocument();

    const tabs = await screen.findAllByRole("tab");
    const tabLabels = tabs.map((tab) => within(tab).getByText((_, el) => el?.className === "dv-default-tab-content").textContent);
    expect(new Set(tabLabels)).toEqual(new Set(["Scenes", "Modules", "Canvas", "Inspector", "History", "Preview", "Graphs", "Quests"]));
  });

  it("opens the pack-swap dialog from the toolbar", async () => {
    render(<App />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Swap Art Pack" }));

    expect(screen.getByRole("dialog", { name: "Swap Art Pack" })).toBeInTheDocument();
  });
});
