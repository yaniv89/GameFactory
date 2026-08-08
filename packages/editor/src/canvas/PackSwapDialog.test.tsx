import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PackSwapDialog } from "./PackSwapDialog";

const NOOP = () => {};

describe("PackSwapDialog", () => {
  it("prompts to choose a pack before a target is selected, with no diff area shown yet", () => {
    render(
      <PackSwapDialog
        open
        onClose={NOOP}
        currentPackName="@forge-fixtures/starter-pack"
        availablePackNames={["@forge-fixtures/starter-pack", "@forge-fixtures/scifi-pack"]}
        targetPackName={undefined}
        onSelectTarget={NOOP}
        diffState="loading"
        findings={[]}
        onRetryDiff={NOOP}
        applying={false}
        onApply={NOOP}
        checkpoints={[]}
        onRestoreCheckpoint={NOOP}
        onDeleteCheckpoint={NOOP}
        previewOpen={false}
        onTogglePreview={NOOP}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={[]}
        terrainRemap={{}}
        remapOpen={false}
        onToggleRemap={NOOP}
        missingTerrains={[]}
        targetTerrains={[]}
        onSetTerrainRemap={NOOP}
      />,
    );
    expect(screen.getByText(/Choose a pack above/)).toBeInTheDocument();
    expect(screen.queryByText("Compatibility")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply swap" })).toBeDisabled();
  });

  it("excludes the currently active pack from the target picker's options", () => {
    render(
      <PackSwapDialog
        open
        onClose={NOOP}
        currentPackName="@forge-fixtures/starter-pack"
        availablePackNames={["@forge-fixtures/starter-pack", "@forge-fixtures/scifi-pack"]}
        targetPackName={undefined}
        onSelectTarget={NOOP}
        diffState="loading"
        findings={[]}
        onRetryDiff={NOOP}
        applying={false}
        onApply={NOOP}
        checkpoints={[]}
        onRestoreCheckpoint={NOOP}
        onDeleteCheckpoint={NOOP}
        previewOpen={false}
        onTogglePreview={NOOP}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={[]}
        terrainRemap={{}}
        remapOpen={false}
        onToggleRemap={NOOP}
        missingTerrains={[]}
        targetTerrains={[]}
        onSetTerrainRemap={NOOP}
      />,
    );
    expect(screen.queryByRole("option", { name: "@forge-fixtures/starter-pack" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "@forge-fixtures/scifi-pack" })).toBeInTheDocument();
  });

  it("calls onSelectTarget when a pack is chosen", async () => {
    const onSelectTarget = vi.fn();
    render(
      <PackSwapDialog
        open
        onClose={NOOP}
        currentPackName={undefined}
        availablePackNames={["@forge-fixtures/starter-pack"]}
        targetPackName={undefined}
        onSelectTarget={onSelectTarget}
        diffState="loading"
        findings={[]}
        onRetryDiff={NOOP}
        applying={false}
        onApply={NOOP}
        checkpoints={[]}
        onRestoreCheckpoint={NOOP}
        onDeleteCheckpoint={NOOP}
        previewOpen={false}
        onTogglePreview={NOOP}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={[]}
        terrainRemap={{}}
        remapOpen={false}
        onToggleRemap={NOOP}
        missingTerrains={[]}
        targetTerrains={[]}
        onSetTerrainRemap={NOOP}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("Switch to"), "@forge-fixtures/starter-pack");
    expect(onSelectTarget).toHaveBeenCalledWith("@forge-fixtures/starter-pack");
  });

  it("shows a loading skeleton while the diff is being computed", () => {
    render(
      <PackSwapDialog
        open
        onClose={NOOP}
        currentPackName="@forge-fixtures/starter-pack"
        availablePackNames={["@forge-fixtures/starter-pack", "@forge-fixtures/scifi-pack"]}
        targetPackName="@forge-fixtures/scifi-pack"
        onSelectTarget={NOOP}
        diffState="loading"
        findings={[]}
        onRetryDiff={NOOP}
        applying={false}
        onApply={NOOP}
        checkpoints={[]}
        onRestoreCheckpoint={NOOP}
        onDeleteCheckpoint={NOOP}
        previewOpen={false}
        onTogglePreview={NOOP}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={[]}
        terrainRemap={{}}
        remapOpen={false}
        onToggleRemap={NOOP}
        missingTerrains={[]}
        targetTerrains={[]}
        onSetTerrainRemap={NOOP}
      />,
    );
    expect(screen.getByRole("status", { name: /Loading compatibility/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply swap" })).toBeDisabled();
  });

  it("shows an error message and retries when the target manifest fails to load, whatever the reason", async () => {
    const onRetryDiff = vi.fn();
    render(
      <PackSwapDialog
        open
        onClose={NOOP}
        currentPackName="@forge-fixtures/starter-pack"
        availablePackNames={["@forge-fixtures/starter-pack", "@forge-fixtures/scifi-pack"]}
        targetPackName="@forge-fixtures/scifi-pack"
        onSelectTarget={NOOP}
        diffState="error"
        findings={[]}
        errorMessage="Failed to fetch"
        onRetryDiff={onRetryDiff}
        applying={false}
        onApply={NOOP}
        checkpoints={[]}
        onRestoreCheckpoint={NOOP}
        onDeleteCheckpoint={NOOP}
        previewOpen={false}
        onTogglePreview={NOOP}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={[]}
        terrainRemap={{}}
        remapOpen={false}
        onToggleRemap={NOOP}
        missingTerrains={[]}
        targetTerrains={[]}
        onSetTerrainRemap={NOOP}
      />,
    );
    expect(screen.getByText("This pack can't be compared")).toBeInTheDocument();
    expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetryDiff).toHaveBeenCalledOnce();
  });

  it("shows an error message for an invalid target manifest too", () => {
    render(
      <PackSwapDialog
        open
        onClose={NOOP}
        currentPackName="@forge-fixtures/starter-pack"
        availablePackNames={["@forge-fixtures/starter-pack", "@forge-fixtures/scifi-pack"]}
        targetPackName="@forge-fixtures/scifi-pack"
        onSelectTarget={NOOP}
        diffState="error"
        findings={[]}
        errorMessage="manifest failed validation"
        onRetryDiff={NOOP}
        applying={false}
        onApply={NOOP}
        checkpoints={[]}
        onRestoreCheckpoint={NOOP}
        onDeleteCheckpoint={NOOP}
        previewOpen={false}
        onTogglePreview={NOOP}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={[]}
        terrainRemap={{}}
        remapOpen={false}
        onToggleRemap={NOOP}
        missingTerrains={[]}
        targetTerrains={[]}
        onSetTerrainRemap={NOOP}
      />,
    );
    expect(screen.getByText("This pack can't be compared")).toBeInTheDocument();
    expect(screen.getByText("manifest failed validation")).toBeInTheDocument();
  });

  it("renders real OK/WARN/FAIL findings with their text labels, not color alone", () => {
    render(
      <PackSwapDialog
        open
        onClose={NOOP}
        currentPackName="@pixelfoundry/fantasy-pack"
        availablePackNames={["@pixelfoundry/fantasy-pack", "@moonlit/scifi-pack"]}
        targetPackName="@moonlit/scifi-pack"
        onSelectTarget={NOOP}
        diffState="populated"
        findings={[
          { severity: "ok", message: "2 tiles map by terrain tag" },
          { severity: "warn", message: "Tile size differs (32 -> 16)", detail: "Scenes will be rescaled." },
          { severity: "fail", message: "1 prop has no equivalent: 'water'", detail: "These will render as placeholders until remapped." },
        ]}
        onRetryDiff={NOOP}
        applying={false}
        onApply={NOOP}
        checkpoints={[]}
        onRestoreCheckpoint={NOOP}
        onDeleteCheckpoint={NOOP}
        previewOpen={false}
        onTogglePreview={NOOP}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={[]}
        terrainRemap={{}}
        remapOpen={false}
        onToggleRemap={NOOP}
        missingTerrains={[]}
        targetTerrains={[]}
        onSetTerrainRemap={NOOP}
      />,
    );
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("2 tiles map by terrain tag")).toBeInTheDocument();
    expect(screen.getByText("WARN")).toBeInTheDocument();
    expect(screen.getByText("Tile size differs (32 -> 16)")).toBeInTheDocument();
    expect(screen.getByText("Scenes will be rescaled.")).toBeInTheDocument();
    expect(screen.getByText("FAIL")).toBeInTheDocument();
    expect(screen.getByText("1 prop has no equivalent: 'water'")).toBeInTheDocument();
  });

  it("labels the Apply button 'Apply anyway' when the diff has a FAIL finding", () => {
    render(
      <PackSwapDialog
        open
        onClose={NOOP}
        currentPackName="@pixelfoundry/fantasy-pack"
        availablePackNames={["@pixelfoundry/fantasy-pack", "@moonlit/scifi-pack"]}
        targetPackName="@moonlit/scifi-pack"
        onSelectTarget={NOOP}
        diffState="populated"
        findings={[{ severity: "fail", message: "1 prop has no equivalent: 'water'" }]}
        onRetryDiff={NOOP}
        applying={false}
        onApply={NOOP}
        checkpoints={[]}
        onRestoreCheckpoint={NOOP}
        onDeleteCheckpoint={NOOP}
        previewOpen={false}
        onTogglePreview={NOOP}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={[]}
        terrainRemap={{}}
        remapOpen={false}
        onToggleRemap={NOOP}
        missingTerrains={[]}
        targetTerrains={[]}
        onSetTerrainRemap={NOOP}
      />,
    );
    expect(screen.getByRole("button", { name: "Apply anyway" })).toBeEnabled();
  });

  it("calls onApply when Apply is clicked once the diff is populated", async () => {
    const onApply = vi.fn();
    render(
      <PackSwapDialog
        open
        onClose={NOOP}
        currentPackName="@pixelfoundry/fantasy-pack"
        availablePackNames={["@pixelfoundry/fantasy-pack", "@moonlit/scifi-pack"]}
        targetPackName="@moonlit/scifi-pack"
        onSelectTarget={NOOP}
        diffState="populated"
        findings={[{ severity: "ok", message: "2 tiles map by terrain tag" }]}
        onRetryDiff={NOOP}
        applying={false}
        onApply={onApply}
        checkpoints={[]}
        onRestoreCheckpoint={NOOP}
        onDeleteCheckpoint={NOOP}
        previewOpen={false}
        onTogglePreview={NOOP}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={[]}
        terrainRemap={{}}
        remapOpen={false}
        onToggleRemap={NOOP}
        missingTerrains={[]}
        targetTerrains={[]}
        onSetTerrainRemap={NOOP}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Apply swap" }));
    expect(onApply).toHaveBeenCalledOnce();
  });

  it("shows a loading Apply button and calls onClose on Cancel", async () => {
    const onClose = vi.fn();
    render(
      <PackSwapDialog
        open
        onClose={onClose}
        currentPackName="@pixelfoundry/fantasy-pack"
        availablePackNames={["@pixelfoundry/fantasy-pack", "@moonlit/scifi-pack"]}
        targetPackName="@moonlit/scifi-pack"
        onSelectTarget={NOOP}
        diffState="populated"
        findings={[{ severity: "ok", message: "2 tiles map by terrain tag" }]}
        onRetryDiff={NOOP}
        applying={true}
        onApply={NOOP}
        checkpoints={[]}
        onRestoreCheckpoint={NOOP}
        onDeleteCheckpoint={NOOP}
        previewOpen={false}
        onTogglePreview={NOOP}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={[]}
        terrainRemap={{}}
        remapOpen={false}
        onToggleRemap={NOOP}
        missingTerrains={[]}
        targetTerrains={[]}
        onSetTerrainRemap={NOOP}
      />,
    );
    expect(screen.getByRole("button", { name: "Apply swap" })).toHaveAttribute("aria-busy", "true");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows an honest empty state when there are no checkpoints yet", () => {
    render(
      <PackSwapDialog
        open
        onClose={NOOP}
        currentPackName="@pixelfoundry/fantasy-pack"
        availablePackNames={["@pixelfoundry/fantasy-pack", "@moonlit/scifi-pack"]}
        targetPackName={undefined}
        onSelectTarget={NOOP}
        diffState="loading"
        findings={[]}
        onRetryDiff={NOOP}
        applying={false}
        onApply={NOOP}
        checkpoints={[]}
        onRestoreCheckpoint={NOOP}
        onDeleteCheckpoint={NOOP}
        previewOpen={false}
        onTogglePreview={NOOP}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={[]}
        terrainRemap={{}}
        remapOpen={false}
        onToggleRemap={NOOP}
        missingTerrains={[]}
        targetTerrains={[]}
        onSetTerrainRemap={NOOP}
      />,
    );
    expect(screen.getByText(/No checkpoints yet/)).toBeInTheDocument();
  });

  it("lists checkpoints and fires onRestoreCheckpoint/onDeleteCheckpoint with the right id", async () => {
    const onRestoreCheckpoint = vi.fn();
    const onDeleteCheckpoint = vi.fn();
    render(
      <PackSwapDialog
        open
        onClose={NOOP}
        currentPackName="@pixelfoundry/fantasy-pack"
        availablePackNames={["@pixelfoundry/fantasy-pack", "@moonlit/scifi-pack"]}
        targetPackName={undefined}
        onSelectTarget={NOOP}
        diffState="loading"
        findings={[]}
        onRetryDiff={NOOP}
        applying={false}
        onApply={NOOP}
        checkpoints={[
          { id: "c1", label: "Before switching to scifi-pack", createdAt: "2026-08-08T12:00:00.000Z" },
        ]}
        onRestoreCheckpoint={onRestoreCheckpoint}
        onDeleteCheckpoint={onDeleteCheckpoint}
        previewOpen={false}
        onTogglePreview={NOOP}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={[]}
        terrainRemap={{}}
        remapOpen={false}
        onToggleRemap={NOOP}
        missingTerrains={[]}
        targetTerrains={[]}
        onSetTerrainRemap={NOOP}
      />,
    );
    expect(screen.getByText("Before switching to scifi-pack")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onRestoreCheckpoint).toHaveBeenCalledWith("c1");

    await userEvent.click(screen.getByRole("button", { name: "Delete checkpoint: Before switching to scifi-pack" }));
    expect(onDeleteCheckpoint).toHaveBeenCalledWith("c1");
  });

  it("shows no Preview/Remap controls until the diff is actually populated", () => {
    render(
      <PackSwapDialog
        open
        onClose={NOOP}
        currentPackName="@pixelfoundry/fantasy-pack"
        availablePackNames={["@pixelfoundry/fantasy-pack", "@moonlit/scifi-pack"]}
        targetPackName="@moonlit/scifi-pack"
        onSelectTarget={NOOP}
        diffState="loading"
        findings={[]}
        onRetryDiff={NOOP}
        applying={false}
        onApply={NOOP}
        checkpoints={[]}
        onRestoreCheckpoint={NOOP}
        onDeleteCheckpoint={NOOP}
        previewOpen={false}
        onTogglePreview={NOOP}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={[]}
        terrainRemap={{}}
        remapOpen={false}
        onToggleRemap={NOOP}
        missingTerrains={["water"]}
        targetTerrains={["grass", "dirt"]}
        onSetTerrainRemap={NOOP}
      />,
    );
    expect(screen.queryByRole("button", { name: "Preview changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remap manually" })).not.toBeInTheDocument();
  });

  it("shows a Preview changes toggle once populated, and fires onTogglePreview", async () => {
    const onTogglePreview = vi.fn();
    render(
      <PackSwapDialog
        open
        onClose={NOOP}
        currentPackName="@pixelfoundry/fantasy-pack"
        availablePackNames={["@pixelfoundry/fantasy-pack", "@moonlit/scifi-pack"]}
        targetPackName="@moonlit/scifi-pack"
        onSelectTarget={NOOP}
        diffState="populated"
        findings={[{ severity: "ok", message: "3 tiles map by terrain tag" }]}
        onRetryDiff={NOOP}
        applying={false}
        onApply={NOOP}
        checkpoints={[]}
        onRestoreCheckpoint={NOOP}
        onDeleteCheckpoint={NOOP}
        previewOpen={false}
        onTogglePreview={onTogglePreview}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={[]}
        terrainRemap={{}}
        remapOpen={false}
        onToggleRemap={NOOP}
        missingTerrains={[]}
        targetTerrains={[]}
        onSetTerrainRemap={NOOP}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(onTogglePreview).toHaveBeenCalledOnce();
  });

  it("renders the live side-by-side preview's own controls when previewOpen is true", () => {
    render(
      <PackSwapDialog
        open
        onClose={NOOP}
        currentPackName="@pixelfoundry/fantasy-pack"
        availablePackNames={["@pixelfoundry/fantasy-pack", "@moonlit/scifi-pack"]}
        targetPackName="@moonlit/scifi-pack"
        onSelectTarget={NOOP}
        diffState="populated"
        findings={[{ severity: "ok", message: "3 tiles map by terrain tag" }]}
        onRetryDiff={NOOP}
        applying={false}
        onApply={NOOP}
        checkpoints={[]}
        onRestoreCheckpoint={NOOP}
        onDeleteCheckpoint={NOOP}
        previewOpen={true}
        onTogglePreview={NOOP}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={new Array(20 * 15).fill(0)}
        terrainRemap={{}}
        remapOpen={false}
        onToggleRemap={NOOP}
        missingTerrains={[]}
        targetTerrains={[]}
        onSetTerrainRemap={NOOP}
      />,
    );
    expect(screen.getByRole("button", { name: "Hide preview" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Comparison divider" })).toBeInTheDocument();
    // Scoped to a <span>: "@moonlit/scifi-pack" is also the target
    // picker's own selected <option> text, which getByText would
    // otherwise match too and report as ambiguous.
    expect(screen.getByText("@pixelfoundry/fantasy-pack", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("@moonlit/scifi-pack", { selector: "span" })).toBeInTheDocument();
  });

  it("hides Remap manually when there's nothing to remap, and shows it when there is", () => {
    const { rerender } = render(
      <PackSwapDialog
        open
        onClose={NOOP}
        currentPackName="@pixelfoundry/fantasy-pack"
        availablePackNames={["@pixelfoundry/fantasy-pack", "@moonlit/scifi-pack"]}
        targetPackName="@moonlit/scifi-pack"
        onSelectTarget={NOOP}
        diffState="populated"
        findings={[{ severity: "ok", message: "3 tiles map by terrain tag" }]}
        onRetryDiff={NOOP}
        applying={false}
        onApply={NOOP}
        checkpoints={[]}
        onRestoreCheckpoint={NOOP}
        onDeleteCheckpoint={NOOP}
        previewOpen={false}
        onTogglePreview={NOOP}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={[]}
        terrainRemap={{}}
        remapOpen={false}
        onToggleRemap={NOOP}
        missingTerrains={[]}
        targetTerrains={["grass", "dirt"]}
        onSetTerrainRemap={NOOP}
      />,
    );
    expect(screen.queryByRole("button", { name: "Remap manually" })).not.toBeInTheDocument();

    rerender(
      <PackSwapDialog
        open
        onClose={NOOP}
        currentPackName="@pixelfoundry/fantasy-pack"
        availablePackNames={["@pixelfoundry/fantasy-pack", "@moonlit/scifi-pack"]}
        targetPackName="@moonlit/scifi-pack"
        onSelectTarget={NOOP}
        diffState="populated"
        findings={[{ severity: "fail", message: "1 prop has no equivalent: 'water'" }]}
        onRetryDiff={NOOP}
        applying={false}
        onApply={NOOP}
        checkpoints={[]}
        onRestoreCheckpoint={NOOP}
        onDeleteCheckpoint={NOOP}
        previewOpen={false}
        onTogglePreview={NOOP}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={[]}
        terrainRemap={{}}
        remapOpen={false}
        onToggleRemap={NOOP}
        missingTerrains={["water"]}
        targetTerrains={["grass", "dirt"]}
        onSetTerrainRemap={NOOP}
      />,
    );
    expect(screen.getByRole("button", { name: "Remap manually" })).toBeInTheDocument();
  });

  it("lists a Select per missing terrain and fires onSetTerrainRemap with the chosen substitute (or undefined for the placeholder)", async () => {
    const onSetTerrainRemap = vi.fn();
    render(
      <PackSwapDialog
        open
        onClose={NOOP}
        currentPackName="@pixelfoundry/fantasy-pack"
        availablePackNames={["@pixelfoundry/fantasy-pack", "@moonlit/scifi-pack"]}
        targetPackName="@moonlit/scifi-pack"
        onSelectTarget={NOOP}
        diffState="populated"
        findings={[{ severity: "fail", message: "1 prop has no equivalent: 'water'" }]}
        onRetryDiff={NOOP}
        applying={false}
        onApply={NOOP}
        checkpoints={[]}
        onRestoreCheckpoint={NOOP}
        onDeleteCheckpoint={NOOP}
        previewOpen={false}
        onTogglePreview={NOOP}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={[]}
        terrainRemap={{}}
        remapOpen={true}
        onToggleRemap={NOOP}
        missingTerrains={["water"]}
        targetTerrains={["grass", "dirt", "sand"]}
        onSetTerrainRemap={onSetTerrainRemap}
      />,
    );
    const remapSelect = screen.getByLabelText("'water' ->");
    await userEvent.selectOptions(remapSelect, "sand");
    expect(onSetTerrainRemap).toHaveBeenCalledWith("water", "sand");

    await userEvent.selectOptions(remapSelect, "No substitute (placeholder)");
    expect(onSetTerrainRemap).toHaveBeenCalledWith("water", undefined);
  });

  it("pre-selects the currently active remap for a missing terrain", () => {
    render(
      <PackSwapDialog
        open
        onClose={NOOP}
        currentPackName="@pixelfoundry/fantasy-pack"
        availablePackNames={["@pixelfoundry/fantasy-pack", "@moonlit/scifi-pack"]}
        targetPackName="@moonlit/scifi-pack"
        onSelectTarget={NOOP}
        diffState="populated"
        findings={[{ severity: "fail", message: "1 prop has no equivalent: 'water'" }]}
        onRetryDiff={NOOP}
        applying={false}
        onApply={NOOP}
        checkpoints={[]}
        onRestoreCheckpoint={NOOP}
        onDeleteCheckpoint={NOOP}
        previewOpen={false}
        onTogglePreview={NOOP}
        sourceContext={undefined}
        targetContext={undefined}
        previewTiles={[]}
        terrainRemap={{ water: "sand" }}
        remapOpen={true}
        onToggleRemap={NOOP}
        missingTerrains={["water"]}
        targetTerrains={["grass", "dirt", "sand"]}
        onSetTerrainRemap={NOOP}
      />,
    );
    expect(screen.getByLabelText("'water' ->")).toHaveValue("sand");
  });
});
