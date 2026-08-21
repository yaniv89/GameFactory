import type { Meta, StoryObj } from "@storybook/react";
import { DialogueTreeEditorDialog } from "./DialogueTreeEditorDialog";

const meta: Meta<typeof DialogueTreeEditorDialog> = {
  title: "Editor/DialogueTreeEditorDialog",
  component: DialogueTreeEditorDialog,
};
export default meta;

type Story = StoryObj<typeof DialogueTreeEditorDialog>;

const NOOP = () => {};

export const Empty: Story = {
  args: { open: true, onClose: NOOP, entityLabel: "Elder", nodes: [], onChange: NOOP },
};

export const OneLine: Story = {
  args: {
    open: true,
    onClose: NOOP,
    entityLabel: "Shopkeeper",
    nodes: [{ speaker: "Shopkeeper", text: "Welcome to my shop!" }],
    onChange: NOOP,
  },
};

export const Branching: Story = {
  args: {
    open: true,
    onClose: NOOP,
    entityLabel: "Elder",
    nodes: [
      {
        speaker: "Elder",
        text: "The village needs your help. Will you accept the quest?",
        choices: [
          { id: "accept", text: "I accept.", next: 1 },
          { id: "decline", text: "Not now.", next: 2 },
        ],
      },
      { speaker: "Elder", text: "Wonderful! The wolves have been terrorizing the mill. Start there." },
      { speaker: "Elder", text: "I understand. Return when you're ready." },
    ],
    onChange: NOOP,
  },
};
