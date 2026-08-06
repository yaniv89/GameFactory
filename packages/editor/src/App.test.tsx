import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("mounts the shell and adds all four panels via Dockview", async () => {
    render(<App />);
    expect(screen.getByText("Forge")).toBeInTheDocument();

    const tabs = await screen.findAllByRole("tab");
    const tabLabels = tabs.map((tab) => within(tab).getByText((_, el) => el?.className === "dv-default-tab-content").textContent);
    expect(new Set(tabLabels)).toEqual(new Set(["Scenes", "Modules", "Canvas", "Inspector"]));
  });
});
