import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InspectorPanel } from "./InspectorPanel";

describe("InspectorPanel", () => {
  it("shows the empty-state copy when nothing is selected", () => {
    render(<InspectorPanel state="empty" />);
    expect(screen.getByText("Nothing selected")).toBeInTheDocument();
  });

  it("shows the current selection when populated", () => {
    render(<InspectorPanel state="populated" selectionLabel="NPC: Shopkeeper (entity #3)" />);
    expect(screen.getByText("NPC: Shopkeeper (entity #3)")).toBeInTheDocument();
  });
});
