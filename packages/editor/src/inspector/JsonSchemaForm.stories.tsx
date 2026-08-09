import type { Meta, StoryObj } from "@storybook/react";
import { JsonSchemaForm } from "./JsonSchemaForm";

const meta: Meta<typeof JsonSchemaForm> = {
  title: "Editor/JsonSchemaForm",
  component: JsonSchemaForm,
};
export default meta;

type Story = StoryObj<typeof JsonSchemaForm>;

/** The exact shape of docs/SPEC.md Section 9.2's `@acme/weather-system` example configSchema. */
export const ModuleConfigExample: Story = {
  args: {
    schema: {
      type: "object",
      properties: {
        seasonLengthDays: { type: "integer", title: "Season length (days)", minimum: 1 },
        startSeason: {
          type: "string",
          title: "Start season",
          enum: ["spring", "summer", "autumn", "winter"],
        },
      },
      required: ["seasonLengthDays", "startSeason"],
    },
    values: { seasonLengthDays: 28, startSeason: "spring" },
    onSubmit: () => {},
  },
};

/** Blur the empty "Name" field to see the inline validation error commit-blocking looks like. */
export const RequiredStringField: Story = {
  args: {
    schema: {
      type: "object",
      properties: { name: { type: "string", title: "Name", minLength: 1 } },
      required: ["name"],
    },
    values: { name: "" },
    onSubmit: () => {},
  },
};
