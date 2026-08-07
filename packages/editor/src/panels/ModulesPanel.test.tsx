import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModulesPanel } from "./ModulesPanel";

const NOOP = () => {};

describe("ModulesPanel", () => {
  it("shows the empty-state copy and fires onBrowseMarketplace", async () => {
    const onBrowseMarketplace = vi.fn();
    render(
      <ModulesPanel
        state="empty"
        onInstall={NOOP}
        onUninstall={NOOP}
        onBrowseMarketplace={onBrowseMarketplace}
      />,
    );
    expect(screen.getByText("No modules installed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Browse the marketplace" }));
    expect(onBrowseMarketplace).toHaveBeenCalledOnce();
  });

  it("lists modules when populated", () => {
    render(
      <ModulesPanel
        state="populated"
        onInstall={NOOP}
        onUninstall={NOOP}
        onBrowseMarketplace={NOOP}
        modules={[{ name: "@forge/dialogue", summary: "Dialogue trees.", installed: false, configurable: false }]}
      />,
    );
    expect(screen.getByText("@forge/dialogue")).toBeInTheDocument();
    expect(screen.getByText("Dialogue trees.")).toBeInTheDocument();
  });

  it("shows an Install button for a module that isn't installed, and fires onInstall", async () => {
    const onInstall = vi.fn();
    render(
      <ModulesPanel
        state="populated"
        onInstall={onInstall}
        onUninstall={NOOP}
        onBrowseMarketplace={NOOP}
        modules={[{ name: "@forge/dialogue", summary: "Dialogue trees.", installed: false, configurable: false }]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(onInstall).toHaveBeenCalledWith("@forge/dialogue");
  });

  it("shows an Uninstall button but no Configure button for an installed, non-configurable module", () => {
    render(
      <ModulesPanel
        state="populated"
        onInstall={NOOP}
        onUninstall={NOOP}
        onBrowseMarketplace={NOOP}
        modules={[{ name: "@forge/dialogue", summary: "Dialogue trees.", installed: true, configurable: false }]}
      />,
    );
    expect(screen.getByRole("button", { name: "Uninstall" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Configure" })).not.toBeInTheDocument();
  });

  it("shows Configure and Uninstall for an installed, configurable module, firing each callback", async () => {
    const onUninstall = vi.fn();
    const onConfigure = vi.fn();
    render(
      <ModulesPanel
        state="populated"
        onInstall={NOOP}
        onUninstall={onUninstall}
        onConfigure={onConfigure}
        onBrowseMarketplace={NOOP}
        modules={[
          { name: "@forge/turn-battle", summary: "1v1 combat.", installed: true, configurable: true },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Configure" }));
    expect(onConfigure).toHaveBeenCalledWith("@forge/turn-battle");

    await userEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    expect(onUninstall).toHaveBeenCalledWith("@forge/turn-battle");
  });
});
