import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "./Checkbox";

describe("Checkbox", () => {
  it("toggles when clicked", async () => {
    render(<Checkbox label="Enable cloud saves" />);
    const box = screen.getByRole("checkbox", { name: "Enable cloud saves" });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(box).toBeChecked();
  });

  it("sets the indeterminate DOM property", () => {
    render(<Checkbox label="Select all" indeterminate />);
    const box = screen.getByRole("checkbox", { name: "Select all" }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
  });
});
