import type { Meta, StoryObj } from "@storybook/react";
import { Toast, ToastViewport } from "./Toast";

const meta: Meta<typeof Toast> = {
  title: "Primitives/Toast",
  component: Toast,
};
export default meta;

type Story = StoryObj<typeof Toast>;

export const Info: Story = {
  args: {
    toast: { id: "1", variant: "info", message: "Build queued for the live channel." },
    onDismiss: () => {},
  },
};

export const Success: Story = {
  args: {
    toast: { id: "2", variant: "success", message: "Published to hollow-crown.forge.dev." },
    onDismiss: () => {},
  },
};

/** Error copy follows CLAUDE.md 5.6, attributing the failure to the specific module. */
export const ErrorVariant: Story = {
  name: "Error",
  args: {
    toast: {
      id: "3",
      variant: "error",
      message:
        "Dynamic Weather 0.9.4 by Acme Interactive caused an error and was disabled for this session.",
    },
    onDismiss: () => {},
  },
};

export const Caution: Story = {
  args: {
    toast: { id: "4", variant: "caution", message: "Too many builds. You can start another in 4 minutes." },
    onDismiss: () => {},
  },
};

/**
 * Empty is deliberately "renders nothing" — see the note in Toast.tsx.
 * This story documents that decision rather than showing a blank canvas.
 */
export const ViewportEmpty: StoryObj<typeof ToastViewport> = {
  render: () => <ToastViewport toasts={[]} onDismiss={() => {}} />,
};

export const ViewportStacked: StoryObj<typeof ToastViewport> = {
  render: () => (
    <ToastViewport
      toasts={[
        { id: "1", variant: "success", message: "Published to hollow-crown.forge.dev." },
        { id: "2", variant: "caution", message: "Tile size differs. Scenes will be rescaled." },
      ]}
      onDismiss={() => {}}
    />
  ),
};
