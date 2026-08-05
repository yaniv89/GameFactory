import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Dialog } from "./Dialog";
import { Button } from "../Button/Button";

const meta: Meta<typeof Dialog> = {
  title: "Primitives/Dialog",
  component: Dialog,
};
export default meta;

type Story = StoryObj<typeof Dialog>;

export const Default: Story = {
  render: () => {
    function Demo() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Open dialog
          </Button>
          <Dialog
            open={open}
            title="Delete project?"
            onClose={() => setOpen(false)}
            actions={
              <>
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={() => setOpen(false)}>
                  Delete project
                </Button>
              </>
            }
          >
            This deletes "The Hollow Crown" and all its revisions. This cannot
            be undone.
          </Dialog>
        </>
      );
    }
    return <Demo />;
  },
};
