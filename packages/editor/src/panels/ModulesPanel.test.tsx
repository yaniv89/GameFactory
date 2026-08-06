import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModulesPanel } from "./ModulesPanel";

describe("ModulesPanel", () => {
  it("shows the empty-state copy and fires onBrowseMarketplace", async () => {
    const onBrowseMarketplace = vi.fn();
    render(<ModulesPanel state="empty" onBrowseMarketplace={onBrowseMarketplace} />);
    expect(screen.getByText("No modules installed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Browse the marketplace" }));
    expect(onBrowseMarketplace).toHaveBeenCalledOnce();
  });

  it("lists installed modules when populated", () => {
    render(
      <ModulesPanel
        state="populated"
        onBrowseMarketplace={() => {}}
        modules={[{ name: "@forge/dialogue", summary: "Dialogue trees." }]}
      />,
    );
    expect(screen.getByText("@forge/dialogue")).toBeInTheDocument();
    expect(screen.getByText("Dialogue trees.")).toBeInTheDocument();
  });
});
