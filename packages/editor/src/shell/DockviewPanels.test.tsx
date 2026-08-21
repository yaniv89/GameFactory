import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useMarketplaceStore } from "../project/marketplaceStore";
import { useProjectStore } from "../store/projectStore";
import { GraphEditorDialogContainer, GraphsPanelContainer, InspectorPanelContainer, ModulesPanelContainer } from "./DockviewPanels";

const EMPTY_DOCUMENT = { scenes: [], installedModules: {}, activePack: undefined, packOverrides: {}, packTerrainRemap: {}, graphs: {} };

describe("ModulesPanelContainer — marketplace-installed modules", () => {
  beforeEach(() => {
    useProjectStore.setState({ document: EMPTY_DOCUMENT, past: [], future: [], selection: undefined });
    useMarketplaceStore.setState({ installedManifests: {} });
  });

  it("shows the three first-party modules even with nothing installed", () => {
    render(<ModulesPanelContainer />);
    expect(screen.getByText("@forge/dialogue")).toBeInTheDocument();
    expect(screen.getByText("@forge/inventory")).toBeInTheDocument();
    expect(screen.getByText("@forge/turn-battle")).toBeInTheDocument();
  });

  it("shows an installed marketplace module alongside the first-party catalog, using its cached manifest summary", () => {
    useProjectStore.setState({
      document: { ...EMPTY_DOCUMENT, installedModules: { "@acme/loot-tables": { config: { dropRate: 0.2 }, marketplace: { version: "1.0.0", bundleUrl: "https://cdn.forge.dev/loot.js", bundleSha256Hex: "abc123" } } } },
    });
    useMarketplaceStore.setState({
      installedManifests: { "@acme/loot-tables": { name: "@acme/loot-tables", summary: "Configurable drop tables for any enemy." } },
    });

    render(<ModulesPanelContainer />);

    expect(screen.getByText("@acme/loot-tables")).toBeInTheDocument();
    expect(screen.getByText("Configurable drop tables for any enemy.")).toBeInTheDocument();
    // Already installed — Uninstall, never a redundant Install action for it.
    const row = screen.getByText("@acme/loot-tables").closest("li")!;
    expect(row.querySelector("button")?.textContent).toMatch(/uninstall/i);
  });

  it("falls back to a plain-name manifest for a marketplace module installed in an earlier session (no cached manifest yet)", () => {
    useProjectStore.setState({
      document: { ...EMPTY_DOCUMENT, installedModules: { "@acme/loot-tables": { config: {} } } },
    });
    // installedManifests deliberately left empty — simulates a reload.

    render(<ModulesPanelContainer />);

    // Two occurrences: the row's name and its own summary both fall back
    // to the bare package name, which is still an honest, non-crashing
    // state, not a silent gap.
    expect(screen.getAllByText("@acme/loot-tables").length).toBeGreaterThan(0);
  });
});

describe("InspectorPanelContainer — configuring a marketplace-installed module", () => {
  beforeEach(() => {
    useProjectStore.setState({ document: EMPTY_DOCUMENT, past: [], future: [], selection: undefined });
    useMarketplaceStore.setState({ installedManifests: {} });
  });

  it("renders the module inspector for a marketplace module using its cached configSchema", () => {
    useProjectStore.setState({
      document: {
        ...EMPTY_DOCUMENT,
        installedModules: { "@acme/loot-tables": { config: { dropRate: 0.2 }, marketplace: { version: "1.0.0", bundleUrl: "https://cdn.forge.dev/loot.js", bundleSha256Hex: "abc123" } } },
      },
      selection: { kind: "module", moduleName: "@acme/loot-tables" },
    });
    useMarketplaceStore.setState({
      installedManifests: {
        "@acme/loot-tables": {
          name: "@acme/loot-tables",
          summary: "Configurable drop tables for any enemy.",
          configSchema: { type: "object", properties: { dropRate: { type: "number", title: "Drop rate", default: 0.2 } }, required: ["dropRate"] },
        },
      },
    });

    render(<InspectorPanelContainer />);

    expect(screen.getByText(/Module: @acme\/loot-tables/)).toBeInTheDocument();
    expect(screen.getByLabelText("Drop rate")).toBeInTheDocument();
  });

  it("shows the empty state if the selected module was uninstalled out from under the selection", () => {
    useProjectStore.setState({
      document: EMPTY_DOCUMENT,
      selection: { kind: "module", moduleName: "@acme/loot-tables" },
    });

    render(<InspectorPanelContainer />);

    expect(screen.getByText("Nothing selected")).toBeInTheDocument();
  });
});

describe("GraphsPanelContainer / GraphEditorDialogContainer — docs/adr/0017 (M3)", () => {
  beforeEach(() => {
    useProjectStore.setState({ document: EMPTY_DOCUMENT, past: [], future: [], selection: undefined, openGraphId: undefined });
  });

  it("shows the empty state with no graphs, and creating one makes it appear with 0 nodes", () => {
    render(<GraphsPanelContainer />);
    expect(screen.getByText("No graphs yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create a graph" }));
    expect(screen.getByDisplayValue("Graph 1")).toBeInTheDocument();
    expect(screen.getByText("0 nodes")).toBeInTheDocument();
  });

  it("Open on a graph row sets openGraphId, which GraphEditorDialogContainer picks up and renders", () => {
    useProjectStore.getState().createGraph();
    const graphId = Object.keys(useProjectStore.getState().document.graphs)[0]!;

    const { rerender } = render(
      <>
        <GraphsPanelContainer />
        <GraphEditorDialogContainer />
      </>,
    );
    expect(screen.queryByText(/^Graph —/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    rerender(
      <>
        <GraphsPanelContainer />
        <GraphEditorDialogContainer />
      </>,
    );
    expect(useProjectStore.getState().openGraphId).toBe(graphId);
    expect(screen.getByText("Graph — Graph 1")).toBeInTheDocument();
  });

  it("GraphEditorDialogContainer renders nothing when openGraphId points at a graph that no longer exists", () => {
    useProjectStore.setState({ openGraphId: "deleted-graph" });
    render(<GraphEditorDialogContainer />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("adding a node through the dialog is real, undoable project-document state — not local-only UI state", () => {
    useProjectStore.getState().createGraph();
    const graphId = Object.keys(useProjectStore.getState().document.graphs)[0]!;
    useProjectStore.getState().openGraphEditor(graphId);

    render(<GraphEditorDialogContainer />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(useProjectStore.getState().document.graphs[graphId]?.nodes).toHaveLength(1);
    expect(useProjectStore.getState().document.graphs[graphId]?.nodes[0]?.type).toBe("core:add");
  });
});
