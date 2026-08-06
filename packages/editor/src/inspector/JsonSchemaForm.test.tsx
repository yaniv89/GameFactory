import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JsonSchemaForm } from "./JsonSchemaForm";
import type { ObjectSchema } from "./jsonSchema";

const SCHEMA: ObjectSchema = {
  type: "object",
  properties: {
    name: { type: "string", title: "Name", minLength: 1 },
    startSeason: { type: "string", title: "Start season", enum: ["spring", "summer"] },
    seasonLengthDays: { type: "integer", title: "Season length (days)", minimum: 1 },
    enabled: { type: "boolean", title: "Enabled" },
  },
  required: ["name"],
};

describe("JsonSchemaForm", () => {
  it("renders a field per schema property, using its title as the label", () => {
    render(
      <JsonSchemaForm
        schema={SCHEMA}
        values={{ name: "Village", startSeason: "spring", seasonLengthDays: 28, enabled: true }}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Village");
    expect(screen.getByLabelText("Start season")).toHaveValue("spring");
    expect(screen.getByLabelText("Season length (days)")).toHaveValue(28);
    expect(screen.getByLabelText("Enabled")).toBeChecked();
  });

  it("commits a valid edit when the field is blurred", async () => {
    const onSubmit = vi.fn();
    render(<JsonSchemaForm schema={SCHEMA} values={{ name: "Village" }} onSubmit={onSubmit} />);

    const nameField = screen.getByLabelText("Name");
    await userEvent.clear(nameField);
    await userEvent.type(nameField, "Riverside");
    await userEvent.tab();

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: "Riverside" }));
  });

  it("shows an inline error and does not commit an invalid edit", async () => {
    const onSubmit = vi.fn();
    render(<JsonSchemaForm schema={SCHEMA} values={{ name: "Village" }} onSubmit={onSubmit} />);

    const nameField = screen.getByLabelText("Name");
    await userEvent.clear(nameField);
    await userEvent.tab();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not clobber an in-progress edit when re-rendered with an equal-but-new values object", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <JsonSchemaForm schema={SCHEMA} values={{ name: "Village" }} onSubmit={onSubmit} />,
    );
    // Same content, new object identity — simulates a parent selector
    // returning a fresh object on an unrelated re-render.
    rerender(<JsonSchemaForm schema={SCHEMA} values={{ name: "Village" }} onSubmit={onSubmit} />);
    expect(screen.getByLabelText("Name")).toHaveValue("Village");
  });
});
